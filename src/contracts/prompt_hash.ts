import * as Client from 'prompt_hash';
import { rpcUrl } from './util';

export default new Client.Client({
  networkPassphrase: 'Test SDF Network ; September 2015',
  contractId: 'CBUOTP3OC5QQFWMEZ72G3ODJ2MFL6NBNHVHVREDOO4JL5NAS32NZ42YK',
  rpcUrl,
  allowHttp: true,
  publicKey: undefined,
});
