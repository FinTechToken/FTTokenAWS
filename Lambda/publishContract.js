'use strict';
/*
  { account: PublicEtherAddress, token: FTToken_Token, contractName, contractABI, publishedAddress } // Publish contract
  ToDo: send in solidity code and compile/publish server side.
*/
var AWS = require('aws-sdk'),
  documentClient = new AWS.DynamoDB.DocumentClient(),
  now,
  twentyMinutesAgo,
  respondToRequest, 
  request;

exports.publishContract = function(event, context, callback) {
	if(requestHasProperFormat(event)) {
    respondToRequest = callback;
    request = event;
    now = new Date();
    twentyMinutesAgo = new Date();
    twentyMinutesAgo.setMinutes(now.getMinutes() - 20);
    documentClient.get(searchForToken(), publishContractIfAccountTokenMatch);		
	} else {
    callback('Not Proper Format', null);
  }
};

function requestHasProperFormat(event) {
	if(!event.account || !event.token || !event.contractName || !event.contractABI || !event.publishedAddress || event.contractName.includes(':'))
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

function publishContractIfAccountTokenMatch(err, data) {
	if(err)
		respondToRequest('DB Error', null);
	else if(isAccountTokenMatch(data.Item))
    getAccountAndPublishContract(data.Item);
  else
    respondToRequest('DB Error', null);
}

  function isAccountTokenMatch(item) {
    return(item && item[process.env.KEY_NAME] == request.account && item.aTokenDate);
  }

  function getAccountAndPublishContract(tokens) {
    if(isRecentToken(tokens.aTokenDate))
      publishContract();
    else
      respondToRequest('DB Error', null);
  }

    function isRecentToken(tokenDate) {
      if(twentyMinutesAgo.toISOString() < tokenDate)
        return true;
      return false;
    }

    function publishContract() {
      documentClient.query(getContractVer(), incrementVersionAndPublishContract);
    }

      function getContractVer() {
        return {
          TableName: 'Contracts',
          KeyConditionExpression: 'PublicAddress = :a and begins_with(ContractNameVer, :b)',
          ExpressionAttributeValues: {
            ':a': request.account,
            ':b': request.contractName + ':'
          }
        };
      }

      function incrementVersionAndPublishContract(err, data) {
        if(err)
          respondToRequest('DB Error', null);
        else {
         let index = 0;
         if(data.Count) {
          index = getMax(data);
         }
          documentClient.put(putContract(index), null);
          documentClient.put(putContractAuthor(index), null);
          respondToRequest(null, true);
          //ToDo: make synch
        }
      }

        function getMax(data) {
          let max = 0;
          for(let i=0; i++; i<data.Count) {
            if(data.Items[i].ContractNameVer.split(':')[1] > max)
              max = data.Items[i].ContractNameVer.split(':')[1];
          }
          return max+1;
        }

        function putContract(index) {
          return {
            TableName: 'Contracts',
            Item: {
              PublicAddress: request.publishedAddress,
              ContractNameVer: request.contractName + ':' + index,
              ContractABI: request.contractABI,
              AuthorAddress: request.account
            }
          };
        }

        function putContractAuthor(index) {
          return {
            TableName: 'Contracts',
            Item: {
              PublicAddress: request.account,
              ContractNameVer: request.contractName + ':' + index,
              ContractABI: request.contractABI,
              PublishedAddress: request.publishedAddress
            }
          };
        }
