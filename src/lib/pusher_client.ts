// Import Pusher dynamically so tests without the `pusher` package don't fail.
let PusherLib: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  PusherLib = require('pusher');
} catch (e) {
  PusherLib = null;
}

const appId = process.env.PUSHER_APP_ID;
const key = process.env.PUSHER_KEY;
const secret = process.env.PUSHER_SECRET;
const cluster = process.env.PUSHER_CLUSTER;

let pusher: any = null;
if (PusherLib && appId && key && secret) {
  pusher = new PusherLib({ appId, key, secret, cluster, useTLS: true });
}

export function getPusher(){ return pusher; }
