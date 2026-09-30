// /api/token/ (login) and /api/token/refresh/ -> Django on Render. See functions/_authProxy.js.
import { proxyAuth } from '../../_authProxy';

export const onRequest = (context) => proxyAuth(context);
