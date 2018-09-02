#!/bin/sh

DATADIR=/home/$USER/priv/data
GENESIS=/home/$USER/priv/config/CustomGenesis.json
NETWORKID=913945103463586943
IDENTITY="@FTT_instancename"
PORT=30303
RPCPORT=8000

# Initialize the private blockchain
geth --networkid $NETWORKID --datadir=$DATADIR --identity $IDENTITY --port $PORT --rpcport $RPCPORT init $GENESIS
