PBTX RPC Service
================

[PBTX](https://github.com/fixpayments/pbtx) is a blockchain
transaction protocol that is optimized for mobile and embedded
systems.

This repository implements an RPC interface, so that PBTX clients can
send the transactions to the blockchain, using HTTP protocol.

Configuration
-------------

The following parameters are be configurable for an RPC installation:

* `URL_PATH`, the path part of the RPC URL.

* `NETWORK_ID`, a 64-bit PBTX network identifier.

* `ANTELOPE_RPC`, an URL of the Antelope (ex-EOSIO) RPC endpoint.

* `ANTELOPE_CONTRACT`, a 12-symbol name of an Antelope account where
  PBTX contract is deployed.

* `ANTELOPE_ADMIN`, a 12-symbol name of the Antelope account that is
  creating PBTX accounts.

* `ANTELOPE_ADMIN_PK`, private key for the admin account.

* `ANTELOPE_WORKER`, a 12-symbol name of the Antelope account that is
  pushing transactions to the blockchain.

* `ANTELOPE_WORKER_PK`, private key for the worker account.

* credentials verification procedure for RegisterAccount requests
  (TBD).

* backend configuration: location and credentials for the data stored
  by the RPC (TBD).



RPC Methods
-----------

Each of the RPC methods is implemented as HTTP POST request. If the
request format is correct and the RPC backend is able to process it,
the HTTP status code should always be "200 OK", even if the response
status is different from SUCCESS.

HTTP error status codes mean that the request cannot be processed at
all.

The content of the POST request and response is a Protobuf serialized
message. It is up to the transport protocol to guarantee the
completeness of the message (in HTTP POST, the message length is
specified in Content-length header).

Each response message contains a sha256 hash of the original
serialized request message it responds to.

`BASE_URL` is an URL consisting of the host part and configurable
`URL_PATH`.

* `BASE_URL/register_account` takes a `pbtxrpc.RegisterAccount` message
  and returns a `pbtxrpc.RegisterAccountResponse`. The backend sends a
  `regactor` action to the PBTX smart contract if the permissionobject
  differs from a previously known one, or if it's a new actor
  account. It also returns the current `seqnum` and `prev_hash` from
  `actorseq` table in the contract.

* `BASE_URL/get_seq` takes a `pbtxrpc.GetSeq` message and returns a
  `pbtxrpc.GetSeq`. The backend retrieves the current `seqnum` and
  `prev_hash` from for the account and returns them alongside the
  network ID.


* `BASE_URL/send_transaction` takes a `pbtx.Transaction` message and
  returns `pbtxrpc.SendTransactionResponse`. The backend tries sending
  the transaction to the blockchain. Additionally it stores the
  transaction in a local storage, so that it can be re-submitted in
  case of a microfork in the blockchain.


