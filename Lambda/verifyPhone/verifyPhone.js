'use strict';
/*
  { account: PublicEthereumAddress, token: FTToken_Token } // True if there is a verified phone, false if not.
  { phone: USPhoneNumber, account: PublicEthereumAddress, token: FTToken_Token } // Add phone and SMS code to verify
  { phone: USPhoneNumber, account: PublicEthereumAddress, token: FTToken_Token, code: 6DigitCode } // verify added phone
*/
var AWS = require('aws-sdk'),
	uuid = require('uuid/v4'),
	crypto = require('crypto'),
  twilio = require('twilio'),
  biguint = require('biguint-format'),
  client = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN),
  documentClient = new AWS.DynamoDB.DocumentClient(),
  now,
  twentyMinutesAgo,
  cryptAlgorithm = 'aes-256-ctr',
  password = process.env.PASSWORD,
  newToken,
  newCode,
  request,
  respondToRequest;

exports.handler = (event, context, callback) => {
  respondToRequest = callback;
  request = event;
  
  now = new Date();
  twentyMinutesAgo = new Date();
  newToken = uuid();
  newCode = randomSixDigitCode();
  twentyMinutesAgo.setMinutes(now.getMinutes() - 20);

  if(isValidRequest(request))
    documentClient.get(searchForToken(), startVerifyPhone);
  else
    callback('Not Proper Format', null);
};

function startVerifyPhone(err, data) {
  if(err) 
    respondToRequest('DB Error', null);
  else if(isValidToken(data.Item)) {
    if(request.phone) {
      if(isValidPhone(checkEvent.phone))
        documentClient.query(doesPhoneExist(), verifyPhone);
      else
        callback('Not Proper Format', null);
    }
    else
      documentClient.get(searchForKey(), seeIfAccountHasPhone);
  } else 
    respondToRequest('DB Error', null);
}

  function isValidPhone(phone) {
    if(phone && +phone > 1000000000 && +phone < 9999999999)
      return true;
    return false;
  }

  function isValidRequest(checkEvent) {
    return (checkEvent.account && checkEvent.token);
  }

function doesPhoneExist() {
	return {
    TableName: process.env.TABLE_NAME_PHONE,
    KeyConditionExpression: process.env.KEY_NAME_PHONE +' = :a',
    ExpressionAttributeValues: {
      ':a': encrypt(request.phone)
    }
	};
}

function verifyPhone(err, data) {
  if(err){
    respondToRequest('DB Error' , null);
  }
  else if(data.Count) {
    let Item = data.Items[0];
    if(isPhoneAccount(Item)) {
      if(Item.Verified)
        respondToRequest('DB Error', null);
      else
        verifySubmittedPhoneCodeAndCheckValidTokenThenVerifyPhone(Item);
    } else {
      respondToRequest(null, 'AccountExists')
    }
  } else {
    documentClient.get(searchForKey(), addPhoneAndSendCode);
  }
}

  function isPhoneAccount(item) {
    return (item && item[process.env.KEY_NAME] == request.account);
  }

  function verifySubmittedPhoneCodeAndCheckValidTokenThenVerifyPhone(phoneInDB) {
    if(isValidSubmittedPhoneCode(phoneInDB.aCode))
      documentClient.get(searchForKey(), checkValidTokenThenVerifyPhone);
    else if(!isRecentSMS(phoneInDB.CreateDate))
      documentClient.get(searchForKey(), checkValidTokenThenResendPhoneCode);
    else 
      respondToRequest(null, 'Sent_Code');
  }

    function isValidSubmittedPhoneCode(phoneCodeInDB) {
      return (phoneCodeInDB == request.code);
    }

    function checkValidTokenThenVerifyPhone(err, data) {
      if(err)
        respondToRequest('DB Error', null);
      else
        documentClient.update(makePhoneVerified(), addPhoneToMainDBAndRespondWithNewToken);
    }

      function makePhoneVerified() {
        return {
          TableName: process.env.TABLE_NAME_PHONE,
          Key: {
            [process.env.KEY_NAME_PHONE]: encrypt(request.phone),
            [process.env.KEY_NAME]: request.account
          },
          UpdateExpression: "REMOVE aCode SET Verified=:b, VerifiedDate=:c",
          ExpressionAttributeValues:{
              ":b":true,
              ":c":now.toISOString()
          }
        };
      }

      function addPhoneToMainDBAndRespondWithNewToken(err, data) {
        if(err)
          respondToRequest('DB Error', null);
        else
          documentClient.update(addNewPhoneToMainDB(), respondWithNewToken);
      }

        function addNewPhoneToMainDB() {
          return {
            TableName: process.env.TABLE_NAME,
            Key: {
              [process.env.KEY_NAME]: request.account
            },
            UpdateExpression: "set Phone=:a",
            ExpressionAttributeValues:{
              ":a": encrypt(request.phone)
            }
          };
        }

        function respondWithNewToken(err, data) {
          if(err)
            respondToRequest('DB Error', null);
          else
            documentClient.put(putToken(), deleteOldTokenAndRespondWithToken);
        }
        
          function putToken() {
            return {
              TableName: process.env.TABLE_NAME_TOKEN,
              Item: {
                [process.env.KEY_NAME_TOKEN]: newToken,
                [process.env.KEY_NAME]: request.account,
                aTokenDate: now.toISOString()
              }
            };
          }

          function deleteOldTokenAndRespondWithToken(err, data) {
            if(err)
              respondToRequest('DB Error', null);
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
              respondToRequest('DB Error', null);
            else
              respondToRequest(null, {account:request.account, token:newToken});
          }

    function isRecentSMS(codeDate) {
      var yesterday = new Date();
      yesterday.setHours(now.getHours() - 24);
      if(yesterday.toISOString() < codeDate)
        return true;
      return false;
    }

    function checkValidTokenThenResendPhoneCode(err, data) {
      if(err)
        respondToRequest('DB Error', null);
      else
        documentClient.update(makeNewPhoneCode(), sendSMSCodeAndResponse);
    }

      function makeNewPhoneCode() {
        return {
          TableName: process.env.TABLE_NAME_PHONE,
          Key: {
            [process.env.KEY_NAME_PHONE]: encrypt(request.phone),
            [process.env.KEY_NAME]: request.account
          },
          UpdateExpression: "set aCode = :a, CreateDate=:b",
          ExpressionAttributeValues:{
              ":a":newCode,
              ":b":now.toISOString()
          }
        };
      }

  function addPhoneAndSendCode(err, data) {
    if(err)
      respondToRequest('DB Error', null);
    else 
      documentClient.put(addNewPhone(), sendSMSCodeAndResponse);
  }

    function addNewPhone() {
      return {
        TableName: process.env.TABLE_NAME_PHONE,
        Item: {
          [process.env.KEY_NAME_PHONE]: encrypt(request.phone),
          [process.env.KEY_NAME]: request.account,
          aCode : newCode,
          CreateDate : now.toISOString()
        }
      };
    }

    function sendSMSCodeAndResponse(err, data) {
      if(err)
        respondToRequest('DB Error', null);
      else
        sendText(newCode);
    }
    
      function sendText(code) {
        client.messages
        .create({
          to: '+1' + request.phone,
          from: process.env.TWILIO_FROM,
          body: 'Code: ' + code + ' for FinTechToken.com'
        })
        .then(message => {respondToRequest(null, 'Sent_Code')});
       respondToRequest(null, 'Sent_Code');
      }

function seeIfAccountHasPhone(err, data) {
  if(err)
    respondToRequest('DB Error', null);
  else {
    if(data.Item.Phone)
      respondToRequest(null, true);
    else
      respondToRequest(null, false);
  } 
}


function searchForKey() {
  return {
    TableName: process.env.TABLE_NAME,
    Key: {
      [process.env.KEY_NAME]: request.account
    }
  };
}

function searchForToken() {
  return {
    TableName: process.env.TABLE_NAME_TOKEN,
    Key: {
      [process.env.KEY_NAME_TOKEN]: request.token
    }
  };
}

function isValidToken(item) {
  return (item && item[process.env.KEY_NAME] == request.account && isTokenRecent(item.aTokenDate));
}

  function isTokenRecent(tokenDate) {
    if(twentyMinutesAgo.toISOString() < tokenDate)
      return true;
    return false;
  }

function encrypt(text) {
  return crypto.createCipher(cryptAlgorithm,password).update(text,'utf8','hex');
}

function randomSixDigitCode() {
  return (+biguint(crypto.randomBytes(3), 'dec')+100000).toString().substring(0,6);
}
