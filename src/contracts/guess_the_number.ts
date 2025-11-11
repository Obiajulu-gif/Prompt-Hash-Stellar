import * as Client from 'guess_the_number';
import { rpcUrl } from './util';

export default new Client.Client({
  networkPassphrase: 'Standalone Network ; February 2017',
  contractId: 'CDLWB42O6XO3H3BQFWSLT2FMNIX42UM5KW7LSH4UQ6H2JMQWXLDGAB7F',
  rpcUrl,
  allowHttp: true,
  publicKey: undefined,
});
