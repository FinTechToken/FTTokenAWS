'use strict';
/*
  { account: PublicEtherAddress, token: FTToken_Token } // Get New Token and Keys within time
  { account: PublicEtherAddress, token: FTToken_Token, expire: true } // Expire the token
  { account: PublicEtherAddress, token: FTToken_Token, phrase: Pass_Phrase } // Get New Token outside of time
*/
var AWS = require('aws-sdk'),
	uuid = require('uuid/v4'),
	crypto = require('crypto'),
  documentClient = new AWS.DynamoDB.DocumentClient(),
  now,
  twentyMinutesAgo,
	cryptAlgorithm = 'aes-256-ctr',
	hashAlgorithm = 'sha256',
	password = process.env.PASSWORD,
	key = process.env.HASH_KEY,
  newToken,
  enc_id, 
  enc_pk,
  respondToRequest, 
  request;

exports.refreshToken = function(event, context, callback) {
	if(!requestHasProperFormat(event)) {
		callback('Not Proper Format', null);
		return;
	}

	respondToRequest = callback;
	request = event;
  newToken = uuid();
  now = new Date();
  twentyMinutesAgo = new Date();
  twentyMinutesAgo.setMinutes(now.getMinutes() - 20);
	documentClient.get(searchForKey(), refreshTokenIfAccountTokenMatch);
};

function requestHasProperFormat(event) {
	if(!event.account || !event.token)
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

function refreshTokenIfAccountTokenMatch(err, data) {
	if(err)
		respondToRequest('DB Error', null);
	else if(isAccountTokenMatch(data.Item))
    refreshToken(data.Item);
  else
    respondToRequest('DB Error', null);
}

  function isAccountTokenMatch(item) {
    return(item && item.aToken == request.token && item.aTokenDate);
  }

  function refreshToken(item) {
    enc_id = item.Encrypted_ID;
    enc_pk = item.Encrypted_PrivateKey;
    if(isRecentToken(item.aTokenDate)) {
      if(request.expire)
        documentClient.update(putNewToken(twentyMinutesAgo), respondWithToken);
      else
        documentClient.update(putNewToken(now), respondWithKeysAndToken);
    } else if(hasCorrectPassPhrase(item))
      documentClient.update(putNewToken(now), respondWithToken);
    else
      respondWithTokenAndEnc_ID(item);
  }

    function isRecentToken(tokenDate) {
      if(twentyMinutesAgo.toISOString() < tokenDate)
        return true;
      return false;
    }

    function putNewToken(times) {
      return {
        TableName: process.env.TABLE_NAME,
        Key: {
          [process.env.KEY_NAME]: request.account
        },
        UpdateExpression: "set aToken = :a, aTokenDate=:b",
        ExpressionAttributeValues:{
            ":a": newToken,
            ":b": times.toISOString()
        }
      };
    }
    
    function respondWithToken(err, data) {
      if(err)
        respondToRequest('DB Error', null);
      else
        respondToRequest(null, {token: newToken});	
    }

    function hasCorrectPassPhrase(item) {
      return (request.phrase && getHash(item[process.env.KEY_NAME] + request.phrase) == item.Hashed_Phrase);
    }

    function respondWithKeysAndToken(err, data) {
      if(err)
        respondToRequest('DB Error', null);
      else
        respondToRequest(null, {token: newToken, enc_id: enc_id, privateKey: decrypt(enc_pk)});	
    }

    function respondWithTokenAndEnc_ID(item) {
      respondToRequest(null, {token: item.aToken, enc_id: enc_id});
    }

 
function decrypt(text){
  return crypto.createDecipher(cryptAlgorithm,password).update(text,'hex','utf8');
}

function getHash(text){
  return crypto.createHmac(hashAlgorithm, key).update(text).digest('hex');
}
