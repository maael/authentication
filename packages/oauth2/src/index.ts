import {Agent, ClientResponse} from 'http';
import {URL} from 'url';
import {Request, Response, NextFunction} from 'express';
import Cookie from '@authentication/cookie';
import {Mixed} from '@authentication/types';
import AuthorizationError from './errors/AuthorizationError';
import StateVerificationFailure from './errors/StateVerificationFailure';
import TokenError from './errors/TokenError';
import InternalOAuthError from './errors/InternalOAuthError';
import getUID from './getUID';
import originalURL from './originalURL';
const OAuth2Base = require('oauth').OAuth2;

export interface Options {
  clientID: string;
  clientSecret: string;

  /**
   * Optionally provide keys to sign the cookie used to store "state"
   */
  cookieKeys?: string[];
  /**
   * Optionally override the default name for the cookie used to store "state"
   *
   * default: "authentication_oauth2"
   */
  cookieName?: string;

  /**
   * Provide a base URL if authorizePath or accessTokenPath are relative.
   */
  baseSite?: string | URL;
  // default: '/oauth/authorize'
  authorizePath?: string | URL;
  // default: '/oauth/access_token'
  accessTokenPath?: string | URL;

  customHeaders?: {[key: string]: string};
  /**
   * This 'hack' method is required for sites that don't use
   * 'access_token' as the name of the access token (for requests).
   * ( http://tools.ietf.org/html/draft-ietf-oauth-v2-16#section-7 )
   * it isn't clear what the correct value should be atm, so allowing
   * for specific (temporary?) override for now.
   *
   * default: 'access_token'
   */
  accessTokenName?: string;
  /**
   * Allows you to set an agent to use instead of the default HTTP or
   * HTTPS agents. Useful when dealing with your own certificates.
   */
  agent?: Agent | boolean;
  /**
   * Sets the authorization method for Authorization header.
   * e.g. Authorization: Bearer <token>  # "Bearer" is the authorization method.
   */
  authMethod?: string;
  /**
   * If you use the OAuth2 exposed 'get' method (and don't construct your own _request call )
   * this will specify whether to use an 'Authorize' header instead of passing the access_token as a query parameter
   */
  useAuthorizationHeaderForGET?: boolean;

  sessionKey?: string;
  scopeSeparator?: string;
  callbackURL?: string | URL;
  trustProxy?: boolean;
}
export interface InitOptions<T> {
  callbackURL?: string | URL;
  params?: {[key: string]: string};
  scope?: string | ReadonlyArray<string>;
  state?: T;
}
export interface CallbackOptions {
  callbackURL?: string | URL;
  params?: {[key: string]: string};
}
export {TokenError};

function resolveURL(
  base: undefined | string | URL,
  path: undefined | string | URL,
  defaultPath: string,
) {
  return path === undefined
    ? new URL(defaultPath, base)
    : typeof path === 'string' ? new URL(path, base) : path;
}

export interface AccessTokenData<Results> {
  accessToken: string;
  refreshToken?: string;
  results: Results;
}

/**
 * Parse error response from OAuth 2.0 endpoint.
 *
 * OAuth 2.0-based authentication strategies can overrride this function in
 * order to parse error responses received from the token endpoint, allowing the
 * most informative message to be displayed.
 *
 * If this function is not overridden, the body will be parsed in accordance
 * with RFC 6749, section 5.2.
 */
function parseErrorResponse(body: string, status: number): TokenError | null {
  const json = JSON.parse(body);
  if (json.error) {
    return new TokenError(
      json.error,
      json.error_description,
      json.error_uri,
      status,
    );
  }
  return null;
}

export default class OAuth2Authentication<State = Mixed, Results = any> {
  private _base: any;
  private _authorizeURL: URL;
  private _accessTokenURL: URL;
  private _clientID: string;
  private _scopeSeparator: string;
  private _callbackURL: void | string | URL;
  private _trustProxy: void | boolean;
  private _cookie: Cookie<{k: string; d?: State}>;
  constructor(options: Options) {
    this._authorizeURL = resolveURL(
      options.baseSite,
      options.authorizePath,
      '/oauth/authorize',
    );
    this._accessTokenURL = resolveURL(
      options.baseSite,
      options.accessTokenPath,
      '/oauth/access_token',
    );
    this._clientID = options.clientID;
    this._base = new OAuth2Base(
      options.clientID,
      options.clientSecret,
      '',
      this._authorizeURL.href,
      this._accessTokenURL.href,
      options.customHeaders,
    );
    if (options.accessTokenName !== undefined) {
      this._base.setAccessTokenName(options.accessTokenName);
    }
    if (options.agent !== undefined) {
      this._base.setAgent(options.agent);
    }
    if (options.authMethod !== undefined) {
      this._base.setAuthMethod(options.authMethod);
    }
    if (options.useAuthorizationHeaderForGET !== undefined) {
      this._base.useAuthorizationHeaderforGET(
        options.useAuthorizationHeaderForGET,
      );
    }

    this._scopeSeparator = options.scopeSeparator || ' ';
    this._callbackURL = options.callbackURL;
    this._trustProxy = options.trustProxy;
    this._cookie = new Cookie(options.cookieName || 'authentication_oauth2', {
      keys: options.cookieKeys,
      maxAge: Cookie.Session,
      sameSite: Cookie.SameSitePolicy.AnySite,
      signed: Cookie.SignedKind.Optional,
    });
  }

  /**
   * Build the authorization header. In particular, build the part after the colon.
   * e.g. Authorization: Bearer <token>  # Build "Bearer <token>"
   */
  buildAuthHeader(token: string): string {
    return this._base.buildAuthHeader(token);
  }

  getAuthorizeUrl(params?: {[key: string]: string}): string {
    return this._base.getAuthorizeUrl(params ? {...params} : params);
  }

  getOAuthAccessToken(
    code: string,
    params?: {[key: string]: string},
  ): Promise<AccessTokenData<Results>> {
    return new Promise<AccessTokenData<Results>>((resolve, reject) => {
      this._base.getOAuthAccessToken(
        code,
        params ? {...params} : {},
        (
          err: any,
          accessToken: string,
          refreshToken: undefined | string,
          results: Results,
        ) => {
          if (err) {
            if (err.statusCode && err.data) {
              try {
                return reject(parseErrorResponse(err.data, err.statusCode));
              } catch (_) {}
            }
            reject(
              new InternalOAuthError('Failed to obtain access token', err),
            );
          } else {
            resolve({
              accessToken,
              refreshToken,
              results,
            });
          }
        },
      );
    });
  }
  get(
    url: string,
    accessToken: string,
  ): Promise<{
    data: string;
    response: ClientResponse;
  }> {
    return new Promise<{
      data: string;
      response: ClientResponse;
    }>((resolve, reject) => {
      this._base.get(
        url,
        accessToken,
        (err: any, data: string, response: ClientResponse) => {
          if (err) {
            reject(err);
          } else {
            resolve({data, response});
          }
        },
      );
    });
  }

  isCallbackRequest(req: Request): boolean {
    return !!(req.query && (req.query.error || req.query.code));
  }
  userCancelledLogin(req: Request): boolean {
    return req.query && req.query.error === 'access_denied';
  }

  /**
   * Begin authentication by getting the URL to redirect the user to on the OAuth 2.0 service provider
   */
  private async _redirectToProvider(
    req: Request,
    res: Response,
    options: InitOptions<State> = {},
  ): Promise<void> {
    const callbackURLInitial = options.callbackURL || this._callbackURL;
    const callbackURL =
      typeof callbackURLInitial === 'string'
        ? new URL(
            callbackURLInitial,
            originalURL(req, {trustProxy: this._trustProxy}),
          )
        : callbackURLInitial;

    const authorizeUrl = new URL(this._authorizeURL.href);
    const p = options.params;
    if (p) {
      Object.keys(p).forEach(key => {
        authorizeUrl.searchParams.set(key, p[key]);
      });
    }

    authorizeUrl.searchParams.set('response_type', 'code');
    if (callbackURL) {
      authorizeUrl.searchParams.set('redirect_uri', callbackURL.href);
    }
    const scope = options.scope;
    if (scope) {
      authorizeUrl.searchParams.set(
        'scope',
        typeof scope === 'string' ? scope : scope.join(this._scopeSeparator),
      );
    }
    authorizeUrl.searchParams.set('client_id', this._clientID);

    const stateID = await getUID(24);
    authorizeUrl.searchParams.set('state', stateID);
    this._cookie.set(req, res, {k: stateID, d: options.state});
    res.redirect(authorizeUrl.href);
  }
  /**
   * Begin authentication by getting the URL to redirect the user to on the OAuth 2.0 service provider
   */
  redirectToProvider(
    req: Request,
    res: Response,
    next: NextFunction,
    options: InitOptions<State> = {},
  ) {
    this._redirectToProvider(req, res, options).catch(next);
  }

  /**
   * Complete authentication by processing the response from the OAuth 2.0 service provider to
   * get the accessToken and refreshToken. These can then be used to fetch a profile.
   */
  async completeAuthentication(
    req: Request,
    res: Response,
    options: CallbackOptions = {},
  ): Promise<{
    accessToken: string;
    refreshToken?: string;
    results: Results;
    state?: State;
  }> {
    if (req.query && req.query.error) {
      throw new AuthorizationError(
        req.query.error,
        req.query.error_description ||
          (req.query.error === 'access_denied'
            ? 'Sign in cancelled'
            : req.query.error),
        req.query.error_uri,
      );
    }
    if (!(req.query && req.query.code)) {
      throw new AuthorizationError(
        'MISSING_CODE',
        'The request is missing the "code" query string parameter.',
        undefined,
      );
    }

    const callbackURLInitial = options.callbackURL || this._callbackURL;
    const callbackURL =
      typeof callbackURLInitial === 'string'
        ? new URL(
            callbackURLInitial,
            originalURL(req, {trustProxy: this._trustProxy}),
          )
        : callbackURLInitial;

    const cookie = this._cookie.get(req, res);
    if (!cookie) {
      throw new StateVerificationFailure(
        'The cookie used to verify state in the oauth transaction was not set.',
      );
    }
    this._cookie.set(req, res, null);
    const {k: stateID, d: state} = cookie;
    if (stateID !== (req.query && req.query.state)) {
      throw new StateVerificationFailure(
        'The oauth provider did not provide a valid "state" parameter in the response.',
      );
    }

    var code = req.query.code;

    const params: {[key: string]: string} = options.params
      ? {...options.params}
      : {};
    params.grant_type = 'authorization_code';
    if (callbackURL) {
      params.redirect_uri = callbackURL.href;
    }
    const {accessToken, refreshToken, results} = await this.getOAuthAccessToken(
      code,
      params,
    );

    // it's up to the consumer to then load the profile
    return {
      accessToken,
      refreshToken,
      results,
      state,
    };
  }
  static AuthorizationError = AuthorizationError;
  static InternalOAuthError = InternalOAuthError;
  static StateVerificationFailure = StateVerificationFailure;
  static TokenError = TokenError;
}

module.exports = OAuth2Authentication;
module.exports.default = OAuth2Authentication;
