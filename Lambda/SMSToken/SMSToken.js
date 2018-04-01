'use strict';
/*
  { phone: USPhoneNumber } // SMS code to sign in
  { phone: USPhoneNumber, code: 6DigitCode } // Verify code to sign in
*/
var AWS = require('aws-sdk'),
	uuid = require('uuid/v4'),
	crypto = require('crypto'),
  twilio = require('twilio');
  biguint = require('biguint-format'),
  client = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN),
  documentClient = new AWS.DynamoDB.DocumentClient(),
  now = new Date(),
  twentyMinutesAgo = new Date(),
  cryptAlgorithm = 'aes-256-ctr',
	password = process.env.PASSWORD,
  newToken = uuid(),
  newCode = randomSixDigitCode(),
  request,
  respondToRequest;

twentyMinutesAgo.setMinutes(now.getMinutes() - 20);

exports.handler = (event, context, callback) => {
  if(!requestHasProperFormat(event)) {
		callback('Not Proper Format', null);
		return;
  }

	respondToRequest = callback;
	request = event;

  documentClient.get(doesPhoneExist(), getTokenUsingSMSCode);
};

function requestHasProperFormat(event) {
  if( isValidPhone(event.phone))
      return true;
  return false;
}

  function isValidPhone(phone) {
    if(phone && isNumber(phone) && phone > 1000000000 && phone < 9999999999)
      return true;
    return false;
  }

function doesPhoneExist() {
	return {
		TableName: process.env.TABLE_NAME_PHONE,
		Key: {
			[process.env.KEY_NAME_PHONE]: encrypt(request.phone)
		}
	};
}

function getTokenUsingSMSCode(err, data) {
	if(err)
		respondToRequest('DB Error', null);
	else if(isPhoneInDB(data.Item) && data.Item.Verified) {
    if(data.Item.Code) {
      if(request.Code) {
        if(isValidSubmittedPhoneCode(data.Item.Code) && data.Item.CodeRetry < 6 && isTokenRecent(data.Item.CodeDate)) {
          request.account = data.Item[process.env.KEY_NAME];
          documentClient.update(erasePhoneCode(), respondWithNewToken);
        } else {
          if(data.Item.CodeRetry < 6 && isTokenRecent(data.Item.CodeDate))
            documentClient.update(increasePhoneCodeRetry(data.Item.CodeRetry+1), errorResponse);
          else
            respondToRequest('DB Error', null);
        }
      } else {
        if(isTokenRecent(data.Item.CodeDate))
          respondToRequest('DB Error', null);
        else
          documentClient.update(putNewCode(), sendSMSCodeAndResponse);
      }
    } else
      documentClient.update(putNewCode(), sendSMSCodeAndResponse);
  }
  else
    respondToRequest('DB Error', null);
}

  function isPhoneInDB(item) {
    return (item && item[process.env.KEY_NAME]);
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
        [process.env.KEY_NAME_PHONE]: encrypt(request.phone)
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
          [process.env.KEY_NAME_PHONE]: encrypt(request.phone)
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
        [process.env.KEY_NAME_PHONE]: encrypt(request.phone)
      },
      UpdateExpression: "set Code=:a, CodeDate=:b, CodeRetry=:c",
      ExpressionAttributeValues: {
        ":a":newCode,
        ":b":now.toISOString(),
        ":c":0
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
      to: '+1' + request.number,
      from: process.env.TWILIO_FROM,
      body: 'FinTechToken verification code: ' + code
    })
    .then(message => {respondToRequest(null, 'Sent_Code')});
  }


function randomSixDigitCode() {
  return (biguint.format(crypto.randomBytes(3), 'dec')+100000).toString().substring(0,6);
}

function encrypt(text) {
  return crypto.createCipher(cryptAlgorithm,password).update(text,'utf8','hex');
}
