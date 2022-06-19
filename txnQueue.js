class WriteTransaction {
    constructor(queue, txn) {
        this.queue = queue;
        this.txn = txn;
    }

    putBinary(dbi, key, value) {
        return this.txn.putBinary(dbi, key, value);
    }

    getBinary(dbi, key) {
        return this.txn.getBinary(dbi, key);
    }

    abort() {
        this.txn.abort();
        
        this.queue._nextTransaction();
    }

    commit() {
        this.txn.commit();
        
        this.queue._nextTransaction();
    }
}

class WriteTransactionQueue {
    constructor(env) {
        this.env = env;
        this.isBusy = false;
        this.queue = [];
    }

    _callbackTransaction(callback) {
        const txn = this.env.beginTxn();

        callback(new WriteTransaction(this, txn));
    }
    
    _nextTransaction() {
        const next = this.queue.shift();
        if (next) {
            _callbackTransaction(next);
        } else {
            this.isBusy = false;
        }
    }

    requestTxn(callback) {
        if (this.isBusy) {
            this.queue.push(callback);
        } else {
            this.isBusy = true;
            this._callbackTransaction(callback);
        }
    }
}

module.exports = {
    WriteTransaction,
    WriteTransactionQueue
}