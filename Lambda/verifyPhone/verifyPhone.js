'use strict';
/*
  { phone: USPhoneNumber, account: PublicEthereumAddress, token: FTToken_Token } // Add phone and SMS code to verify
  { phone: USPhoneNumber, account: PublicEthereumAddress, token: FTToken_Token, code: 6DigitCode } // verify added phone
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

  documentClient.get(doesPhoneExist(), verifyPhone);
};

function requestHasProperFormat(event) {
  if( isValidPhone(event.phone) && isValidRequest(event))
      return true;
  return false;
}

  function isValidPhone(phone) {
    if(phone && isNumber(phone) && phone > 1000000000 && phone < 9999999999)
      return true;
    return false;
  }

  function isValidRequest(event) {
    return (event.account && event.token);
  }

function doesPhoneExist() {
	return {
		TableName: process.env.TABLE_NAME_PHONE,
		Key: {
			[process.env.KEY_NAME_PHONE]: encrypt(request.phone)
		}
	};
}

function verifyPhone(err, data) {
  if(err)
    respondToRequest('DB Error', null);
  else if(isPhoneInDB(data.Item)) {
    if(data.Item.Verified)
      respondToRequest('DB Error', null);
    else 
      verifySubmittedPhoneCodeAndCheckValidTokenThenVerifyPhone(data.Item.aCode);
  }
  else
    documentClient.get(searchForKey(), addPhoneAndSendCode);
}

  function isPhoneInDB(item) {
    return (item && item[process.env.KEY_NAME]);
  }

  function verifySubmittedPhoneCodeAndCheckValidTokenThenVerifyPhone(phoneCodeInDB) {
    if(isValidSubmittedPhoneCode(phoneCodeInDB))
      documentClient.get(searchForKey(), checkValidTokenThenVerifyPhone);
    else
      respondToRequest('DB Error', null);
  }

    function isValidSubmittedPhoneCode(phoneCodeInDB) {
      return (phoneCodeInDB == request.code);
    }

    function checkValidTokenThenVerifyPhone(err, data) {
      if(err)
        respondToRequest('DB Error', null);
      else if(isValidToken(data.Item))
        documentClient.update(makePhoneVerified(), respondWithNewToken);
      else
        respondToRequest('DB Error', null);
    }

      function makePhoneVerified() {
        return {
          TableName: process.env.TABLE_NAME_PHONE,
          Key: {
            [process.env.KEY_NAME_PHONE]: encrypt(request.phone)
          },
          UpdateExpression: "set aCode = :a, Verified=:b, VerifiedDate=:c",
          ExpressionAttributeValues:{
              ":a":null,
              ":b":true,
              ":c":now.toISOString()
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
  return (biguint.format(crypto.randomBytes(3), 'dec')+100000).toString().substring(0,6);
}
