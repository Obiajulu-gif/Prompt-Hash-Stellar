import * as Client from 'fungible_allowlist_example';
import { rpcUrl } from './util';

export default new Client.Client({
  networkPassphrase: 'Standalone Network ; February 2017',
  contractId: 'CC5JS7VARRTEVL6M3WHYANWARD6EMADSGFPDEPGP6HOIJGTS7AVQ3ZU3',
  rpcUrl,
  allowHttp: true,
  publicKey: undefined,
});
