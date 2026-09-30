// /api/auth/logout/ -> Django on Render. See functions/_authProxy.js.
// [[path]] also matches the trailing slash Django uses. Nothing else under /api/auth/ is proxied.
import { proxyAuth } from '../../../_authProxy';

export const onRequest = (context) => proxyAuth(context);
