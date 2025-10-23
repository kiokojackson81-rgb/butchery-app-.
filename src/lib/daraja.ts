// Compatibility wrapper re-exporting the new DarajaClient
import { DarajaClient, yyyymmddhhmmss as _yyyymmddhhmmss } from './daraja_client';
export { DarajaClient };
export const getAccessToken = DarajaClient.fetchToken;
export const darajaPost = DarajaClient.darajaPost;
export const yyyymmddhhmmss = _yyyymmddhhmmss;
