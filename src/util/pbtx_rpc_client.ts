import { Command } from 'commander';
const program = new Command();

import { TransactionBody, Transaction, Permission, KeyType }
from '../../lib/generated/pbtx_pb.js';

import { RegisterAccount, RegisterAccountResponse, RegisterAccountResponse_StatusCode,
         GetSeq, GetSeqResponse, GetSeqResponse_StatusCode,
         SendTransactionResponse, SendTransactionResponse_StatusCode }
from '../../lib/generated/pbtx-rpc_pb.js';

import hash from 'hash.js';
import eosio from '@greymass/eosio';
import fetch from 'node-fetch';
import Long from "long";


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

        const privkey = eosio.PrivateKey.fromString(cmdopts.actorkey);
        const permission_msg = new Permission({
            actor: cmdopts.actor,
            threshold: 1,
            keys: [{
                key: {
                    type: KeyType['EOSIO_KEY'],
                    keyBytes: eosio.Serializer.encode({object: privkey.toPublic()}).array
                },
                weight: 1
            }]
        });

        let creds;
        if( cmdopts.creds !== undefined ) {
            creds = Buffer.from(cmdopts.creds, 'hex');
        }

        const perm_serialized = permission_msg.toBinary();

        const req = new RegisterAccount({
            permissionBytes: perm_serialized,
            signature: eosio.Serializer.encode({object: privkey.signMessage(perm_serialized)}).array,
            credentials: creds
        });

        const req_serialized = req.toBinary();
        const req_hash = hash.sha256().update(req_serialized).digest();

        const response = await fetch(options.url + '/register_account', {
            method: 'POST',
            headers: {'Content-Type': 'application/octet-stream'},
            body: req_serialized});

        if (!response.ok) {
            throw new Error(`HTTP Error Response: ${response.status} ${response.statusText} ${await response.text()}`);
        }

        const input = new Uint8Array(await response.arrayBuffer());
        console.log(Buffer.from(input).toString('hex'));
        const resp_decoded = RegisterAccountResponse.fromBinary(input);

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


program
    .command('trx')
    .requiredOption('--actor [value]', 'actor ID')
    .requiredOption('--actorkey [value]', 'Actor private key')
    .requiredOption('--type [value]', 'Transaction type')
    .requiredOption('--content [value]', 'Transaction content')
    .description('Send a PBTX transaction')
    .action(async (cmdopts) => {
        const options = program.opts();

        let transaction_type :number = cmdopts.type;
        let transaction_content = Buffer.from(cmdopts.content, 'hex');

        const privkey = eosio.PrivateKey.fromString(cmdopts.actorkey);

        const actor = cmdopts.actor;
        let network_id :BigInt;
        let last_seqnum :number;
        let prev_hash :BigInt;

        {
            const getseq_msg = new GetSeq({actor: actor});

            const req_serialized = getseq_msg.toBinary();
            const req_hash = hash.sha256().update(req_serialized).digest();

            const response = await fetch(options.url + '/get_seq', {
                method: 'POST',
                headers: {'Content-Type': 'application/octet-stream'},
                body: req_serialized});

            if (!response.ok) {
                throw new Error(`HTTP Error Response: ${response.status} ${response.statusText} ${await response.text()}`);
            }

            const resp_array = new Uint8Array(await response.arrayBuffer());
            console.log(Buffer.from(resp_array).toString('hex'));
            const resp_decoded = GetSeqResponse.fromBinary(resp_array);

            if( ! Buffer.from(req_hash).equals(resp_decoded['requestHash']) ) {
                throw new Error(`request_hash in response does not match the request. ` +
                                `Expected: ${req_hash}, Got: ${resp_decoded['requestHash']}`);
            }

            console.log('get_seq response: ' + JSON.stringify(resp_decoded));
            network_id = resp_decoded['networkId'];
            last_seqnum = resp_decoded['lastSeqnum'];
            prev_hash = resp_decoded['prevHash'];
        }

        const trxbody = new TransactionBody({
            networkId: network_id,
            actor: actor,
            seqnum: last_seqnum + 1,
            prevHash: prev_hash,
            transactionType: transaction_type,
            transactionContent: transaction_content});

        const body_serialized = TransactionBody.encode(trxbody).finish();
        console.log(Buffer.from(body_serialized).toString('hex'));
        
        const trx_msg = new Transaction({
            body: body_serialized,
            authorities: [
                {
                    type: 0,
                    sigs: [ eosio.Serializer.encode({object: privkey.signMessage(body_serialized)}).array ]
                }
            ]
        });

        const req_serialized = Buffer.from(Transaction.encodeDelimited(trx_msg).finish());
        console.log(Buffer.from(req_serialized).toString('hex'));

        const req_hash = hash.sha256().update(req_serialized).digest();

        const response = await fetch(options.url + '/send_transaction', {
            method: 'POST',
            headers: {'Content-Type': 'application/octet-stream'},
            body: req_serialized});

        if (!response.ok) {
            throw new Error(`HTTP Error Response: ${response.status} ${response.statusText} ${await response.text()}`);
        }

        const resp_decoded = SendTransactionResponse.fromBinary(new Uint8Array(await response.arrayBuffer()));

        if( ! Buffer.from(req_hash).equals(resp_decoded['requestHash']) ) {
            throw new Error(`request_hash in response does not match the request. ` +
                            `Expected: ${req_hash}, Got: ${resp_decoded['requestHash']}`);
        }

        console.log(JSON.stringify({
            status: resp_decoded['status']
        }));
    });



program.parse(process.argv);


/*
 Local Variables:
 mode: javascript
 indent-tabs-mode: nil
 End:
*/
