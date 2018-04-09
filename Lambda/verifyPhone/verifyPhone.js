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

  if(request.phone) {
    if(!requestHasProperFormat(request))
      callback('Not Proper Format', null);
    else
      documentClient.query(doesPhoneExist(), verifyPhone);
  }
  else {
    if(request.account && request.token)
      documentClient.get(searchForKey(), seeIfAccountHasPhone);
    else
      callback('Not Proper Format', null);
  }
};

function requestHasProperFormat(checkEvent) {
  if( isValidPhone(checkEvent.phone) && isValidRequest(checkEvent))
      return true;
  return false;
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
      else if(isValidToken(data.Item))
        documentClient.update(makePhoneVerified(), addPhoneToMainDBAndRespondWithNewToken);
      else
        respondToRequest('DB Error', null);
    }

      function makePhoneVerified() {
        return {
          TableName: process.env.TABLE_NAME_PHONE,
          Key: {
            [process.env.KEY_NAME_PHONE]: encrypt(request.phone),
            [process.env.KEY_NAME]: request.account
          },
          UpdateExpression: "set aCode = :a, Verified=:b, VerifiedDate=:c",
          ExpressionAttributeValues:{
              ":a":null,
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
            documentClient.update(updateToken(), respondWithToken);
        }
        
          function updateToken() {
            return {
              TableName: process.env.TABLE_NAME,
              Key: {
                [process.env.KEY_NAME]: request.account
              },
              UpdateExpression: "set aToken = :a, aTokenDate=:b",
              ExpressionAttributeValues:{
                  ":a":newToken,
                  ":b":now.toISOString()
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
      else if(isValidToken(data.Item))
        documentClient.update(makeNewPhoneCode(), sendSMSCodeAndResponse);
      else
        respondToRequest('DB Error', null);
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
    else if(isValidToken(data.Item))
      documentClient.put(addNewPhone(), sendSMSCodeAndResponse);
    else
      respondToRequest('DB Error', null);
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
  else if(isValidToken(data.Item)) {
    if(data.Item.Phone)
      respondToRequest(null, true);
    else
      respondToRequest(null, false);
  } else
    respondToRequest('DB Error', null);
}


function searchForKey() {
  return {
    TableName: process.env.TABLE_NAME,
    Key: {
      [process.env.KEY_NAME]: request.account
    }
  };
}

function isValidToken(item) {
  return (item && item.aToken == request.token && isTokenRecent(item.aTokenDate));
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
