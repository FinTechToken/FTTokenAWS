'use strict';

var AWS = require('aws-sdk'),
	uuid = require('uuid'),
	crypto = require('crypto'),
	documentClient = new AWS.DynamoDB.DocumentClient(),
	cryptAlgorithm = 'aes-256-ctr',
	hashAlgorithm = 'sha256',
	password = process.env.PASSWORD,
	key = process.env.HASH_KEY,
	newToken = uuid.v1(),
	respondToRequest, request;

exports.newAccount = function(event, context, callback) {
	if(!hasProperFormat(event)) {
		callback('Not Proper Format', null);
		return;
	}

	respondToRequest = callback;
	request = event;

	documentClient.get(doesKeyExists(), ifNewKeyCreateAccount);
};

var hasProperFormat = function(event) {
	if(!event.account || !event.privateKey || !event.phrase || !event.enc_id) {
		return false;
	} else {
		return true;
	}
};

var doesKeyExists = function() {
	return {
		TableName: process.env.TABLE_NAME,
		Key: {
			[process.env.KEY_NAME]: request.account
		}
	};
};

var ifNewKeyCreateAccount = function(err, data) {
	if(err) {
		respondToRequest('DB Error', null);
	} else {
		if(data.Item) {
			respondToRequest('Key Exists: ' + request.account, null);
		} else {
			documentClient.put(putNewAccount(), sendResponseAfterNewAccount);
		}
	}
};

var putNewAccount = function() {
	var now = new Date().toISOString();
	return {
		TableName: process.env.TABLE_NAME,
		Item: {
			[process.env.KEY_NAME]: request.account,
			Encrypted_PrivateKey: encrypt(request.privateKey),
			Encrypted_Phrase: encrypt(request.phrase),
			Hashed_Phrase: getHash(request.phrase),
			Encrypted_ID: request.enc_id,
			Token : newToken,
			TokenDate : now,
			CreateDate : now
		}
	};
};

var sendResponseAfterNewAccount = function(err, data) {
	if(err){
		respondToRequest('Could not write key: ' + request.account, null);
	} else {
		respondToRequest(null, newToken);
	}
};

function encrypt(text){
  return crypto.createCipher(cryptAlgorithm,password).update(text,'utf8','hex');
}
 
function decrypt(text){
  return crypto.createDecipher(cryptAlgorithm,password).update(text,'hex','utf8');
}

function getHash(text){
  return crypto.createHmac(hashAlgorithm, key).update(text).digest('hex');
}
