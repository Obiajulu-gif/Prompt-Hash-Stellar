import * as Client from 'nft_enumerable_example';
import { rpcUrl } from './util';

export default new Client.Client({
  networkPassphrase: 'Standalone Network ; February 2017',
  contractId: 'CAGSR5RAR6MFPFZI7IABADXMOYQ7HB7R3JSTXMR6UVU6JETZSV6GJS27',
  rpcUrl,
  allowHttp: true,
  publicKey: undefined,
});
