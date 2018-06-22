'use strict';
/*
  { account: PublicEthereumAddress, token: FTToken_Token } // Responds With Any Unclaimed Sent Hashes AND Hashes Received { sent:[], received:[] }
  { account: PublicEthereumAddress, token: FTToken_Token, phone: PhoneToSendHashTo } // Creates and Responds with Hash
  { master: PublicEthereumAddress, token: FTToken_Token, delete: Hash } //Hash that was fulfilled.
  { master: PublicEthereumAddress, token: FTToken_Token, funded: Hash } //text phone and update Hash

*/
var AWS = require('aws-sdk'),
  uuid = require('uuid/v4'),
  keccak256 = require('js-sha3').keccak256,
  hashAlgorithm = 'sha256',
  key = process.env.HASH_KEY,
	crypto = require('crypto'),
  twilio = require('twilio'),
  biguint = require('biguint-format'),
  client = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN),
  documentClient = new AWS.DynamoDB.DocumentClient(),
  now,
  twentyMinutesAgo,
  cryptAlgorithm = 'aes-256-ctr',
  password = process.env.PASSWORD,
  passwordOld = process.env.PASSWORDOLD,
  newUUID,
  newHash,
  request,
  phone,
  respondToRequest,
  response = {sent:[], received:[]};

exports.handler = (event, context, callback) => {
    respondToRequest = callback;
    request = event;
    
    now = new Date();
    twentyMinutesAgo = new Date();
    twentyMinutesAgo.setMinutes(now.getMinutes() - 20);
    newUUID= uuid();

    if(isValidRequest())
      documentClient.get(searchForToken(), findAndRespondWithHash);
    else if(isValidMasterRequest())
      documentClient.get(searchForHash(), textPhoneAndUpdateHashORDeleteHash);
    else
      callback('Not Proper Format', null);
  }

  function isValidRequest() {
    return (request.account && request.token);
  }
  
  function isValidMasterRequest() {
    return (request.master == process.env.MASTER && request.token == process.env.MASTER_TOKEN && (request.funded || request.delete) );
  } 

  function searchForToken() {
    return {
      TableName: process.env.TABLE_NAME_TOKEN,
      Key: {
        [process.env.KEY_NAME_TOKEN]: request.token
      }
    };
  }


function findAndRespondWithHash(err, data) {
  if(err) 
    respondToRequest('DB Error1', null);
  else if(isValidToken(data.Item)) {
    if(request.phone) {
      if(isValidPhone(request.phone))
        createAndRespondWithNewHash(data.Item[process.env.KEY_NAME]);
      else
        callback('Not Proper Format', null);
    } else {
      documentClient.query(searchForSentHash(), getSentHashAndGetPhoneAndRespondWithHash);
    }
  } else 
    respondToRequest('DB Error2', null);
}

  function isValidToken(item) {
    return (item && item[process.env.KEY_NAME] == request.account && isTokenRecent(item.aTokenDate));
  }

    function isTokenRecent(tokenDate) {
      if(twentyMinutesAgo.toISOString() < tokenDate)
        return true;
      return false;
    }

    function isValidPhone(phone) {
      if(phone && +phone > 1000000000 && +phone < 9999999999)
        return true;
      return false;
    }

  function createAndRespondWithNewHash(Sender) {
    documentClient.put(putNewHash(Sender), respondWithNewHash);
  }

    function putNewHash(Sender) {
      newHash = keccak256(newUUID);
      return {
        TableName: process.env.TABLE_NAME_HASH,
        Item: {
          [process.env.KEY_NAME_HASH]: newHash,
          [process.env.KEY_NAME_HASH_SENDER]: encrypt(Sender),
          [process.env.KEY_NAME_HASH_PHONE]: encrypt(request.phone),
          HashCreateDate: now.toISOString(),
          UUID: encrypt(newUUID)
        }
      };
    }

    function respondWithNewHash(err, data) {
      if(err)
        respondToRequest('DB Error3', null);
      else
        respondToRequest(null, newHash);
    }

  function searchForSentHash() {
    return {
      TableName: process.env.TABLE_NAME_HASH,
      IndexName: process.env.KEY_NAME_HASH_SENDER + '-index',
      KeyConditionExpression: process.env.KEY_NAME_HASH_SENDER + ' = :a',
      ExpressionAttributeValues: {
        ':a': encrypt(request.account)
      }
    };
  }

  function getSentHashAndGetPhoneAndRespondWithHash(err, data) {
    if(err)
      respondToRequest('DB Error4', null);
    else {
      if(data.Count) {
        data.Items.forEach( (item, index) => {
          response.sent[index] = item[process.env.KEY_NAME_HASH];
        });
      }
      documentClient.get(searchForPhone(), getPhoneAndRespondWithHash);
    }
  }

    function searchForPhone() {
      return {
        TableName: process.env.TABLE_NAME,
        Key: {[process.env.KEY_NAME]: request.account}
      };
    }

    function getPhoneAndRespondWithHash(err, data) {
      if(err)
        respondToRequest('DB Error5', null);
      else {
        if(data.Item[process.env.KEY_NAME_PHONE]) {
          documentClient.query(searchForGotHash(decryptOld(data.Item[process.env.KEY_NAME_PHONE])), respondWithHash);
        } else
        respondToRequest('DB Error6', null);
      }
    }

      function searchForGotHash(phone) {
        return {
          TableName: process.env.TABLE_NAME_HASH,
          IndexName: process.env.KEY_NAME_HASH_PHONE + '-index',
          KeyConditionExpression: process.env.KEY_NAME_HASH_PHONE + ' = :a',
          FilterExpression: "Texted=:b",
          ExpressionAttributeValues: {
            ':a': encrypt(phone),
            ':b': true
          }
        };
      }

      function respondWithHash(err, data) {
        if(err)
          respondToRequest('DB Error7', null);
        else {
          if(data.Count) {
            data.Items.forEach( (item, index) => {
              response.received[index] = decrypt(item[process.env.KEY_NAME_HASH_KEY]);
            });
          }
          respondToRequest(null, response);
        }
      }

function searchForHash() {
  let hash = request.funded ? request.funded : request.delete;
  return {
    TableName: process.env.TABLE_NAME_HASH,
    Key: {[process.env.KEY_NAME_HASH]: hash}
  };
}

  function textPhoneAndUpdateHashORDeleteHash(err, data) {
    if(err)
      respondToRequest('DB Error8', null);
    else if(data.Item) {
      if(request.funded) {
        phone = decrypt(data.Item[process.env.KEY_NAME_HASH_PHONE]);
        if(data.Item.Texted)
          respondToRequest('Already Funded', null);
        else
          documentClient.update(updateHashWithText(), sendTextAndRespondWithSuccess);
      } else if (request.delete) {
        documentClient.delete(searchForHash(), respondWithSuccess);
      } else
        respondToRequest('DB Error9', null);
    } else
      respondToRequest('No Hash Found', null);
  }

    function respondWithSuccess(err, data) {
      if(err)
        respondToRequest(err, null);
      else
        respondToRequest(null,'Deleted');
    }

    function updateHashWithText() {
      return {
        TableName: process.env.TABLE_NAME_HASH,
        Key: {
          [process.env.KEY_NAME_HASH]: request.funded
        },
        UpdateExpression: "SET Texted=:b, TextedDate=:c",
        ExpressionAttributeValues:{
            ":b":true,
            ":c":now.toISOString()
        }
      };
    }

    function sendTextAndRespondWithSuccess(err, data) {
      if(err)
        respondToRequest('DB Error11', null);
      else {
        sendText();
      }
    }

    function sendText() {
      client.messages
      .create({
        to: '+1' + phone,
        from: process.env.TWILIO_FROM,
        body: 'A friend sent you tokens. Get them at FinTechToken.com.'
      })
      .then(message => {respondToRequest(null, 'Sent_Code')});
     respondToRequest(null, 'Sent_Code');
    }

function encrypt(text) {
  return crypto.createCipher(cryptAlgorithm,password).update(text,'utf8','hex');
}

function decrypt(text) {
  return crypto.createDecipher(cryptAlgorithm,password).update(text,'hex','utf8');
}

function decryptOld(text) {
  return crypto.createDecipher(cryptAlgorithm,passwordOld).update(text,'hex','utf8');
}

function getHash(text) {
  return crypto.createHmac(hashAlgorithm, key).update(text).digest('hex');
}