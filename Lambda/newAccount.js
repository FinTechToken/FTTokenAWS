'use strict';
/*
 { account: PublicEtherAddress, privateKey: PrivateKeyOfEtherAddress, phrase: PassPhrase, enc_id: Ethereum_Encrypted_Id } // Add new account
*/
var AWS = require('aws-sdk'),
	uuid = require('uuid/v4'),
	crypto = require('crypto'),
	documentClient = new AWS.DynamoDB.DocumentClient(),
	cryptAlgorithm = 'aes-256-ctr',
	hashAlgorithm = 'sha256',
	password = process.env.PASSWORD,
	key = process.env.HASH_KEY,
	newToken,
	now,
	respondToRequest, 
	request;

exports.newAccount = function(event, context, callback) {
	if(!requestHasProperFormat(event)) {
		callback('Not Proper Format', null);
		return;
	}
	newToken = uuid();
	now = new Date();
	respondToRequest = callback;
	request = event;

	documentClient.get(searchForKey(), createAccountIfNotFound);
};

function requestHasProperFormat(event) {
	if(!event.account || !event.privateKey || !event.phrase || !event.enc_id)
		return false;
	return true;
}

function searchForKey() {
	return {
		TableName: process.env.TABLE_NAME,
		Key: {
			[process.env.KEY_NAME]: request.account
		}
	};
}

function createAccountIfNotFound(err, data) {
	if(err)
		respondToRequest('DB Error', null);
	else if(data.Item)
		respondToRequest('DB Error', null);
	else
		documentClient.put(createNewAccount(), writeTokenAndRespondWithNewTokenOnSuccess);
}

	function createNewAccount() {
		return {
			TableName: process.env.TABLE_NAME,
			Item: {
				[process.env.KEY_NAME]: request.account,
				Encrypted_PrivateKey: encrypt(request.privateKey),
				Encrypted_Phrase: encrypt(request.account + request.phrase),
				Hashed_Phrase: getHash(request.account + request.phrase),
				Encrypted_ID: request.enc_id,
				CreateDate : now.toISOString()
			}
		};
	}

	function writeTokenAndRespondWithNewTokenOnSuccess(err, data) {
		if(err)
			respondToRequest('DB Error', null);
		else
			documentClient.put(createNewToken(), respondWithNewTokenOnSuccess);
	}

	function createNewToken() {
		return {
			TableName: process.env.TABLE_NAME_TOKEN,
			Item: {
				[process.env.KEY_NAME_TOKEN]: newToken,
				[process.env.KEY_NAME]: request.account,
				aTokenDate: now.toISOString()
			}
		};
	}

	function respondWithNewTokenOnSuccess(err, data) {
		if(err)
			respondToRequest('DB Error', null);
		else
			respondToRequest(null, newToken);
	}

	
function encrypt(text){
  return crypto.createCipher(cryptAlgorithm,password).update(text,'utf8','hex');
}

function getHash(text){
  return crypto.createHmac(hashAlgorithm, key).update(text).digest('hex');
}
