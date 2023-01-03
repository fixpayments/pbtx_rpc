import { Command } from 'commander';
const program = new Command();

import protobuf from 'protobufjs';
import hash from 'hash.js';
import eosio from '@greymass/eosio';
import fetch from 'node-fetch';


program
    .requiredOption('--url [value]', 'PBTX-RPC URL');

program
    .command('regacc')
    .requiredOption('--actor [value]', 'actor ID')
    .requiredOption('--actorkey [value]', 'Actor private key')
    .option('--creds [value]', 'Credentials')
    .description('Register an account or retrieve seqnum and prev_hash')
    .action(async (cmdopts) => {
        const options = program.opts();
        
        let rpc_root = protobuf.loadSync('pbtx-rpc.proto').root;
        let pbtx_root = protobuf.loadSync('pbtx/pbtx.proto').root;

        let privkey = eosio.PrivateKey.fromString(cmdopts.actorkey);
        
        let Permission = pbtx_root.lookupType('pbtx.Permission');
        let permission_msg = Permission.create({
            actor: cmdopts.actor,
            threshold: 1,
            keys: [{
                key: {
                    type: pbtx_root.lookupEnum('pbtx.KeyType').values.EOSIO_KEY,
                    keyBytes: eosio.Serializer.encode({object: privkey.toPublic()}).array
                },
                weight: 1
            }]
        });

        let creds;
        if( cmdopts.creds !== undefined ) {
            creds = Buffer.from(cmdopts.creds, 'hex');
        }
        
        let perm_serialized = Permission.encode(permission_msg).finish();
                    
        let RegisterAccount = rpc_root.lookupType('pbtxrpc.RegisterAccount');
        let req = RegisterAccount.create({
            permissionBytes: perm_serialized,
            signature: eosio.Serializer.encode({object: privkey.signMessage(perm_serialized)}).array,
            credentials: creds
        });
        
        let req_serialized = Buffer.from(RegisterAccount.encodeDelimited(req).finish());

        const response = await fetch(options.url + '/register_account', {
            method: 'POST',
            headers: {'Content-Type': 'application/octet-stream'},
            body: req_serialized});
        
        if (!response.ok) {
            throw new Error(`unexpected response ${response.statusText}`);
        }
        
        let RegisterAccountResponse = rpc_root.lookupType('pbtxrpc.RegisterAccountResponse');
        let resp_decoded = RegisterAccountResponse.decodeDelimited(new Uint8Array(await response.arrayBuffer()));
        
        console.log(`response = ${JSON.stringify(resp_decoded)}`);
        
        
    });

program.parse(process.argv);


/*
 Local Variables:
 mode: javascript
 indent-tabs-mode: nil
 End:
*/
