'use strict';
/*
  { phone: USPhoneNumber } // SMS code to sign in
  { phone: USPhoneNumber, code: 6DigitCode } // Verify code to sign in
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
  if(!requestHasProperFormat(event)) {
		callback('Not Proper Format', null);
		return;
  }

  now = new Date();
  twentyMinutesAgo = new Date();
  twentyMinutesAgo.setMinutes(now.getMinutes() - 20);
  newToken = uuid();
  newCode = randomSixDigitCode();

	respondToRequest = callback;
	request = event;

  documentClient.query(doesPhoneExist(), getTokenUsingSMSCode);
};

function requestHasProperFormat(event) {
  if( isValidPhone(event.phone))
      return true;
  return false;
}

  function isValidPhone(phone) {
    if(phone && +phone > 1000000000 && +phone < 9999999999)
      return true;
    return false;
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

function getTokenUsingSMSCode(err, data) {
	if(err)
		respondToRequest('DB Error', null);
  else if(data.Count) {
    let Item = data.Items[0];
    request.account = Item[process.env.KEY_NAME];
    if(Item.Verified || true) {
      if(Item.Code) {
        if(request.code) {
          if(isValidSubmittedPhoneCode(Item.Code) && Item.CodeRetry < 6 && isTokenRecent(Item.CodeDate)) {
            documentClient.update(erasePhoneCode(), respondWithNewToken);
          } else {
            if(Item.CodeRetry < 6 && isTokenRecent(Item.CodeDate))
              documentClient.update(increasePhoneCodeRetry(Item.CodeRetry+1), errorResponse);
            else
              respondToRequest('DB Error', null);
          }
        } else {
          if(isTokenRecent(Item.CodeDate))
            respondToRequest(null, 'Sent_Code');
          else{
            documentClient.update(putNewCode(), sendSMSCodeAndResponse);
          }
        }
      } else {
        documentClient.update(putNewCode(), sendSMSCodeAndResponse);
      }
    } else {
      // Not verified - send code
    }
  }
  else
    respondToRequest('DB Error', null);
}

  function isValidSubmittedPhoneCode(phoneCodeInDB) {
    return (phoneCodeInDB == request.code);
  }

  function isTokenRecent(tokenDate) {
    if(twentyMinutesAgo.toISOString() < tokenDate)
      return true;
    return false;
  }

  function erasePhoneCode() {
    return {
      TableName: process.env.TABLE_NAME_PHONE,
      Key: {
        [process.env.KEY_NAME_PHONE]: encrypt(request.phone),
        [process.env.KEY_NAME]: request.account
      },
      UpdateExpression: "set Code = :a, CodeDate=:b, CodeRetry=:c",
      ExpressionAttributeValues: {
        ":a":null,
        ":b":null,
        ":c":null
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

    function increasePhoneCodeRetry(retry) {
      return {
        TableName: process.env.TABLE_NAME_PHONE,
        Key: {
          [process.env.KEY_NAME_PHONE]: encrypt(request.phone),
          [process.env.KEY_NAME]: request.account
        },
        UpdateExpression: "set CodeRetry=:a",
        ExpressionAttributeValues: {
          ":a":retry
        }
      };
    }

    function errorResponse(err, data) {
      respondToRequest('DB Error', null);
    }

  function putNewCode() {
    return {
      TableName: process.env.TABLE_NAME_PHONE,
      Key: {
        [process.env.KEY_NAME_PHONE]: encrypt(request.phone),
        [process.env.KEY_NAME]: request.account
      },
      UpdateExpression: "set Code=:a, CodeDate=:b, CodeRetry=:c",
      ExpressionAttributeValues: {
        ":a":newCode,
        ":b":now.toISOString(),
        ":c": 0
      }
    };
  }

function sendSMSCodeAndResponse(err, data) {
  if(err)
    respondToRequest('DB Real Error', null);
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
  }


function randomSixDigitCode() {
  return (biguint(crypto.randomBytes(3), 'dec')+100000).toString().substring(0,6);
}

function encrypt(text) {
  return crypto.createCipher(cryptAlgorithm,password).update(text,'utf8','hex');
}
