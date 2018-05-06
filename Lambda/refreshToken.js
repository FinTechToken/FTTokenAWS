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
  theTokenDate,
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
	documentClient.get(searchForToken(), refreshTokenIfAccountTokenMatch);
};

function requestHasProperFormat(event) {
	if(!event.account || !event.token)
		return false;
	return true;
}

function searchForToken() {
	return {
		TableName: process.env.TABLE_NAME_TOKEN,
		Key: {
			[process.env.KEY_NAME_TOKEN]: request.token
		}
	};
}

function refreshTokenIfAccountTokenMatch(err, data) {
	if(err)
		respondToRequest('DB Error1', null);
	else if(isAccountTokenMatch(data.Item))
    getAccountAndRefreshToken(data.Item);
  else
    respondToRequest('DB Error2', null);
}

  function getAccountAndRefreshToken(tokens) {
    theTokenDate = tokens.aTokenDate;
    documentClient.get(searchForAccount(tokens[process.env.KEY_NAME]), refreshToken);
  }

    function searchForAccount(myKey) {
      return {
        TableName: process.env.TABLE_NAME,
        Key: {
          [process.env.KEY_NAME]: myKey
        }
      };
    }

  function isAccountTokenMatch(item) {
    return(item && item[process.env.KEY_NAME] == request.account && item.aTokenDate);
  }

  function refreshToken(err, data) {
    if(err)
      respondToRequest('DB Error3', null);
    else if(data.Item) {
      enc_id = data.Item.Encrypted_ID;
      enc_pk = data.Item.Encrypted_PrivateKey;
      if(isRecentToken(theTokenDate)) {
        if(request.expire)
          documentClient.put(putNewToken(twentyMinutesAgo), deleteOldTokenAndRespondWithToken);
        else
          documentClient.put(putNewToken(now), deleteOldTokenAndRespondWithKeysAndToken);
      } else {
        if(hasCorrectPassPhrase(data.Item.Hashed_Phrase))
          documentClient.put(putNewToken(now), deleteOldTokenAndRespondWithToken);
        else
          respondWithTokenAndEnc_ID();
      }
    } else 
      respondToRequest('DB Error4', null);
  }

    function isRecentToken(tokenDate) {
      if(twentyMinutesAgo.toISOString() < tokenDate)
        return true;
      return false;
    }

    function putNewToken(time) {
      return {
        TableName: process.env.TABLE_NAME_TOKEN,
        Item: {
          [process.env.KEY_NAME_TOKEN]: newToken,
          [process.env.KEY_NAME]: request.account,
          aTokenDate: time.toISOString()
        }
      };
    }

    function deleteOldTokenAndRespondWithKeysAndToken(err, data) {
      if(err)
        respondToRequest('DB Error5', null);
      else
        documentClient.delete(deleteOldToken(), respondWithKeysAndToken);
    }

    function deleteOldTokenAndRespondWithToken(err, data) {
      if(err)
        respondToRequest('DB Error6', null);
      else
        documentClient.delete(deleteOldToken(), respondWithToken);
    }

      function deleteOldToken() {
        return {
          TableName: process.env.TABLE_NAME_TOKEN,
          Key: {
            [process.env.KEY_NAME_TOKEN]: request.token
          }
        };
      }

    function respondWithToken(err, data) {
      if(err)
        respondToRequest('DB Error7', null);
      else
        respondToRequest(null, {token: newToken});	
    }

    function hasCorrectPassPhrase(hashed_phrase) {
      return (request.phrase && getHash(request.account + request.phrase) == hashed_phrase);
    }

    function respondWithKeysAndToken(err, data) {
      if(err)
        respondToRequest('DB Error8' + JSON.stringify(err, null, 2), null);
      else
        respondToRequest(null, {token: newToken, enc_id: enc_id, privateKey: decrypt(enc_pk)});	
    }

    function respondWithTokenAndEnc_ID() {
      respondToRequest(null, {token: request.token, enc_id: enc_id});
    }

 
function decrypt(text){
  return crypto.createDecipher(cryptAlgorithm,password).update(text,'hex','utf8');
}

function getHash(text){
  return crypto.createHmac(hashAlgorithm, key).update(text).digest('hex');
}
