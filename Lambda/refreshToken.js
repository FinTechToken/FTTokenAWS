'use strict';

var AWS = require('aws-sdk'),
	uuid = require('uuid/v4'),
	crypto = require('crypto'),
	documentClient = new AWS.DynamoDB.DocumentClient(),
	cryptAlgorithm = 'aes-256-ctr',
	hashAlgorithm = 'sha256',
	password = process.env.PASSWORD,
	key = process.env.HASH_KEY,
  newToken,
  enc_id, enc_pk,
	respondToRequest, request;

exports.refreshToken = function(event, context, callback) {
	if(!hasProperFormat(event)) {
		callback('Not Proper Format', null);
		return;
	}
  newToken = uuid();
	respondToRequest = callback;
	request = event;

	documentClient.get(doesKeyExists(), ifKeyRefreshToken);
};

var hasProperFormat = function(event) {
	if(!event.account || !event.token) {
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

var ifKeyRefreshToken = function(err, data) {
	if(err) {
		respondToRequest('DB Error', null);
	} else {
		if(data.Item && data.Item.aToken == request.token && data.Item.aTokenDate) {
      enc_id = data.Item.Encrypted_ID;
      enc_pk = data.Item.Encrypted_PrivateKey;
      var now = new Date();
      var twentyMinutesAgo = new Date();
      twentyMinutesAgo.setMinutes(now.getMinutes() - 20);
      twentyMinutesAgo = twentyMinutesAgo.toISOString();
      now = now.toISOString();
      if(twentyMinutesAgo < data.Item.aTokenDate) {
        if(request.expire) {
          documentClient.update(putNewToken(twentyMinutesAgo), sendResponseAfterExpireToken);
        } else {
          documentClient.update(putNewToken(now), sendResponseAfterNewToken);
        }
      } else {
        if(request.phrase && getHash(data.Item[process.env.KEY_NAME] + request.phrase) == data.Item.Hashed_Phrase) {
          documentClient.update(putNewToken(now), sendResponseAfterNewToken);
        } else {
          shareToken(data.Item);
        }
      }
		} else {
      respondToRequest('DB Error', null);
		}
	}
};

var putNewToken = function(now) {
	return {
    TableName: process.env.TABLE_NAME,
    Key: {
      [process.env.KEY_NAME]: request.account
    },
    UpdateExpression: "set aToken = :a, aTokenDate=:b",
    ExpressionAttributeValues:{
        ":a":newToken,
        ":b":now
    }
	};
};

var sendResponseAfterExpireToken= function(err, data) {
  if(err){
		respondToRequest('Could not write key: ' + request.account, null);
	} else {
    respondToRequest(null, {
      "token" : newToken
    });	
	}
};

var sendResponseAfterNewToken= function(err, data) {
  if(err){
		respondToRequest('Could not write key: ' + request.account, null);
	} else {
    respondToRequest(null, {
      "token" : newToken,
      "enc_id" : enc_id,
      "privateKey" : decrypt(enc_pk)
    });	
	}
};

var shareToken = function(item) {
  respondToRequest(null, {
    "token" : item.aToken,
    "enc_id" : enc_id
  });
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
