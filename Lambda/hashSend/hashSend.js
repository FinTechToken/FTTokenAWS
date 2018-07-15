'use strict';
/*
  { account: PublicEthereumAddress, token: FTToken_Token } // Responds With Any Unclaimed Sent Hashes AND Hashes Received { sent:[], received:[] }
  { account: PublicEthereumAddress, token: FTToken_Token, phone: PhoneToSendHashTo } // Creates and Responds with Hash
  { account: PublicEthereumAddress, token: FTToken_Token, phone: PhoneToSendHashTo, refer: true } // Creates and Responds with Hash IF unique phone
  { account: PublicEthereumAddress, token: FTToken_Token, deposit: true } // Creates an unprocessed deposit record  

  { master: PublicEthereumAddress, token: FTToken_Token, delete: Hash } //Hash that was fulfilled. (respond with referee:newAccount,referer:senderAccount) OR respond "Deleted"
  { master: PublicEthereumAddress, token: FTToken_Token, funded: Hash } //text phone and update Hash
  { master: PublicEthereumAddress, token: FTToken_Token, funded: Hash, refer: true } //text phone with invite message and update Hash
  { master: PublicEthereumAddress, token: FTToken_Token, withdrawAddress: address, withdrawAmount: amount, withdrawBlock: block } //text phone with invite message and update Hash
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
  sender,
  referee,
  response = {sent:[], received:[]};

exports.handler = (event, context, callback) => {
    sender = null;
    referee = null;
    phone=null;
    newHash = null;
    response = {sent:[], received:[]};
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
    else if(isValidMasterBankRequest())
      documentClient.query(searchForBank(), insertBank);
    else
      respondToRequest('Not Proper Format', null);
  }

  function isValidRequest() {
    return (request.account && request.token);
  }
  
  function isValidMasterRequest() {
    return (request.master == process.env.MASTER && request.token == process.env.MASTER_TOKEN && (request.funded || request.delete ) );
  } 

  function isValidMasterBankRequest() {
    return (request.master == process.env.MASTER && request.token == process.env.MASTER_TOKEN && request.withdrawAmount && request.withdrawAddress && request.withdrawBlock );
  } 

  function searchForToken() {
    return {
      TableName: process.env.TABLE_NAME_TOKEN,
      Key: {
        [process.env.KEY_NAME_TOKEN]: request.token
      }
    };
  }

  function searchForBank() {
    return {
      TableName: process.env.TABLE_NAME_CB,
      KeyConditionExpression: process.env.KEY_NAME_CB +' = :a and ' + process.env.KEY_NAME_CB2+' = :b',
      FilterExpression: "Withdraw=:c",
      ExpressionAttributeValues: {
        ':a': request.withdrawAddress,
        ':b': request.withdrawBlock,
        ':c': true
      }
    };
  }

  function insertBank(err, data) {
    if(err)
      respondToRequest('DB Error', null);
    else {
      if(data.Count) {
        respondToRequest('AlreadyExist', null);
      }
      else
        documentClient.put(insertBankTrans(), respondWithBankSuccess);
    }
  }

  function insertBankTrans() {
    return {
      TableName: process.env.TABLE_NAME_CB,
      Item: {
        [process.env.KEY_NAME_CB]: request.withdrawAddress,
        [process.env.KEY_NAME_CB2]: request.withdrawBlock,
        Amount: request.withdrawAmount,
        Withdraw: true,
        Processed: false
      }
    };
  }

  function insertNewDeposit() {
    return {
      TableName: process.env.TABLE_NAME_CB,
      Item: {
        [process.env.KEY_NAME_CB]: request.account,
        [process.env.KEY_NAME_CB2]: "0",
        Amount: "0",
        Deposit: true,
        Processed: false
      }
    };
  }

  function respondWithBankSuccess(err, data) {
    if(err)
      respondToRequest('DB Error', null);
    else
      respondToRequest(null,'BankEntry');
  }

function findAndRespondWithHash(err, data) {
  if(err) 
    respondToRequest('DB Error', null);
  else if(isValidToken(data.Item)) {
    if(request.phone) {
      if(isValidPhone(request.phone)) {
        sender = data.Item[process.env.KEY_NAME];
        documentClient.query(doesPhoneExist(request.phone), createAndRespondWithNewHashIfNoPhone);
      }
      else
        respondToRequest('Not Proper Format', null);
    } else if(request.deposit) {
      documentClient.query(searchForDeposits(), insertDeposit);
    } else {
      documentClient.query(searchForSentHash(), getSentHashAndGetPhoneAndRespondWithHash);
    }
  } else 
    respondToRequest('DB Error', null);
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

    function doesPhoneExist(phone) {
      return {
        TableName: process.env.TABLE_NAME_PHONE,
        KeyConditionExpression: process.env.KEY_NAME_PHONE +' = :a',
        ExpressionAttributeValues: {
          ':a': encryptOld(phone)
        }
      };
    }

  function searchForDeposits() {
    return {
      TableName: process.env.TABLE_NAME_CB,
      KeyConditionExpression: process.env.KEY_NAME_CB +' = :a and ' + process.env.KEY_NAME_CB2+' = :b',
      FilterExpression: "Deposit=:c",
      ExpressionAttributeValues: {
        ':a': request.account,
        ':b': "0",
        ':c': true
      }
    };
  }

  function insertDeposit(err, data) {
    if(err)
      respondToRequest('DB Error', null);
    else {
      if(data.Count)
        respondToRequest('AlreadyExists', null);
      else 
      documentClient.put(insertNewDeposit(), respondWithBankSuccess);
    }
  }

  function createAndRespondWithNewHashIfNoPhone(err, data) {
    if(err)
      respondToRequest('DB Error', null);
    else {
      if(data.Count) {
        if(request.refer)
          respondToRequest('DB Error', null); //User exists
        else
          createAndRespondWithNewHash(false);
      }
      else
        documentClient.query(doesPhoneExistInHash(), createAndRespondWithNewHashIfNoPhoneHash);
    }
  }

    function doesPhoneExistInHash() {
      return {
        TableName: process.env.TABLE_NAME_HASH,
        IndexName: process.env.KEY_NAME_HASH_PHONE + '-index',
        KeyConditionExpression: process.env.KEY_NAME_HASH_PHONE + ' = :a',
        FilterExpression: "Refer=:b",
        ExpressionAttributeValues: {
          ':a': encrypt(request.phone),
          ':b': true
        }
      };
    }

    function createAndRespondWithNewHashIfNoPhoneHash(err, data) {
      if(err)
        respondToRequest('DB Error', null);
      else {
        if(data.Count) {
          if(request.refer)
            respondToRequest('DB Error', null); //User exists
          else
            createAndRespondWithNewHash(false);
        }
        else
          createAndRespondWithNewHash(true);
      }
    }

  function createAndRespondWithNewHash(refer) {
    documentClient.put(putNewHash(refer), respondWithNewHash);
  }

    function putNewHash(refer) {
      newHash = keccak256(newUUID);
      if(refer)
        return {
          TableName: process.env.TABLE_NAME_HASH,
          Item: {
            [process.env.KEY_NAME_HASH]: newHash,
            [process.env.KEY_NAME_HASH_SENDER]: encrypt(sender),
            [process.env.KEY_NAME_HASH_PHONE]: encrypt(request.phone),
            HashCreateDate: now.toISOString(),
            UUID: encrypt(newUUID),
            Refer: true
          }
        };
      else {
        return {
          TableName: process.env.TABLE_NAME_HASH,
          Item: {
            [process.env.KEY_NAME_HASH]: newHash,
            [process.env.KEY_NAME_HASH_SENDER]: encrypt(sender),
            [process.env.KEY_NAME_HASH_PHONE]: encrypt(request.phone),
            HashCreateDate: now.toISOString(),
            UUID: encrypt(newUUID)
          }
        };
      }
    }

    function respondWithNewHash(err, data) {
      if(err)
        respondToRequest('DB Error', null);
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
      respondToRequest('DB Error', null);
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
        respondToRequest('DB Error', null);
      else {
        if(data.Item[process.env.KEY_NAME_PHONE]) {
          documentClient.query(searchForGotHash(decryptOld(data.Item[process.env.KEY_NAME_PHONE])), respondWithHash);
        } else
        respondToRequest('DB Error', null);
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
          respondToRequest('DB Error', null);
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
      respondToRequest('DB Error', null);
    else if(data.Item) {
      if(request.funded) {
        phone = decrypt(data.Item[process.env.KEY_NAME_HASH_PHONE]);
        request.refer=data.Item.Refer;
        if(data.Item.Texted)
          respondToRequest('Already Funded', null);
        else
          documentClient.update(updateHashWithText(), sendTextAndRespondWithSuccess);
      } else if (request.delete) {
        documentClient.get(searchForHash(), respondWithSuccessOrReferInfo);
      } else
        respondToRequest('DB Error', null);
    } else
      respondToRequest('No Hash Found', null);
  }

    function respondWithSuccessOrReferInfo(err, data) {
      if(err)
        respondToRequest('DB Error', null);
      else if(data.Item.Refer) {
        sender=decrypt(data.Item.Sender);
        documentClient.query(doesPhoneExist(decrypt(data.Item.Phone)), deleteAndRespondWithReferInfo);
      } else
        documentClient.delete(searchForHash(), respondWithSuccess);
    }

    function deleteAndRespondWithReferInfo(err, data) {
      if(err)
        respondToRequest('DB Error', null);
      else if(data.Count) {
        referee = data.Items[0][process.env.KEY_NAME];
        documentClient.delete(searchForHash(), respondWithReferInfo);
      }
      else
        respondToRequest('DB Error', null);
    }

    function respondWithReferInfo(err, data) {
      if(err)
        respondToRequest('DB Error', null);
      else
        respondToRequest(null, "referer:" + sender + ":referee:" + referee);
    }

    function respondWithSuccess(err, data) {
      if(err)
        respondToRequest('DB Error', null);
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
        respondToRequest('DB Error', null);
      else {
        sendText();
      }
    }

    function sendText() {
      let msg='A friend sent you tokens. Get them at FinTechToken.com.';
      if(request.refer)
        msg='A friend invited you to FinTechToken.com. Take one minute to create an account, so you both get $5.'
      client.messages
      .create({
        to: '+1' + phone,
        from: process.env.TWILIO_FROM,
        body: msg
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

function encryptOld(text) {
  return crypto.createCipher(cryptAlgorithm,passwordOld).update(text,'utf8','hex');
}

function decryptOld(text) {
  return crypto.createDecipher(cryptAlgorithm,passwordOld).update(text,'hex','utf8');
}

function getHash(text) {
  return crypto.createHmac(hashAlgorithm, key).update(text).digest('hex');
}
