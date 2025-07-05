// susu-flow-backend/models/payment.schema.js
const mongoose = require('mongoose');

const PaymentSchema = new mongoose.Schema({
    payer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    recipient: { 
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    amount: {
        type: Number,
        required: true,
        min: 0 
    },
    round: { 
        type: Number,
        required: true,
        min: 1 
    },
    paymentDate: {
        type: Date,
        default: Date.now
    },
    status: {
        type: String,
        enum: ['Pending', 'Complete', 'Failed'], 
        default: 'Pending'
    },
    paymentReference: { 
        type: String,
        required: true,
       
    },
}, { _id: true });

module.exports = PaymentSchema;