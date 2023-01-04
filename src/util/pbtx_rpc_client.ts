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
        
        const rpc_root = protobuf.loadSync('pbtx-rpc.proto').root;
        const pbtx_root = protobuf.loadSync('pbtx/pbtx.proto').root;

        const privkey = eosio.PrivateKey.fromString(cmdopts.actorkey);
        
        const Permission = pbtx_root.lookupType('pbtx.Permission');
        const permission_msg = Permission.create({
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
        
        const perm_serialized = Permission.encode(permission_msg).finish();
                    
        const RegisterAccount = rpc_root.lookupType('pbtxrpc.RegisterAccount');
        const req = RegisterAccount.create({
            permissionBytes: perm_serialized,
            signature: eosio.Serializer.encode({object: privkey.signMessage(perm_serialized)}).array,
            credentials: creds
        });
        
        const req_serialized = Buffer.from(RegisterAccount.encodeDelimited(req).finish());
        const req_hash = hash.sha256().update(req_serialized).digest();
        
        const response = await fetch(options.url + '/register_account', {
            method: 'POST',
            headers: {'Content-Type': 'application/octet-stream'},
            body: req_serialized});
        
        if (!response.ok) {
            throw new Error(`HTTP Error Response: ${response.status} ${response.statusText} ${await response.text()}`);
        }
        
        const RegisterAccountResponse = rpc_root.lookupType('pbtxrpc.RegisterAccountResponse');
        const resp_decoded = RegisterAccountResponse.decodeDelimited(new Uint8Array(await response.arrayBuffer()));

        if( ! Buffer.from(req_hash).equals(resp_decoded['requestHash']) ) {
            throw new Error(`request_hash in response does not match the request. ` +
                            `Expected: ${req_hash}, Got: ${resp_decoded['requestHash']}`);
        }   

        console.log(JSON.stringify({
            status: resp_decoded['status'],
            network_id: resp_decoded['networkId'].toString(),
            last_seqnum: resp_decoded['lastSeqnum'],
            prev_hash: resp_decoded['prevHash'].toString()
        }));
    });

program.parse(process.argv);


/*
 Local Variables:
 mode: javascript
 indent-tabs-mode: nil
 End:
*/
