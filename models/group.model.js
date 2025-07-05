const mongoose = require('mongoose');
const { Schema } = mongoose;
const paymentSchema = require('./payment.schema');

const groupSchema = new Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        minlength: 8
    },
    members: [{
        type: Schema.Types.ObjectId,
        ref: 'User'
    }],
    pendingRequests: [{ 
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User'
        },
        timestamp: {
            type: Date,
            default: Date.now 
        }
    }],
    contributionAmount: {
        type: Number,
        required: true,
        min: 1000
    },
    memberLimit: {
        type: Number,
        required: true,
        min: 2
    },
    cycleFrequency: {
        type: String,
        required: true,
        enum: ['daily', 'weekly', 'bi-weekly', 'monthly']
    },
    startDate: {
        type: Date,
        required: true
    },
    collectionOrder: [{
        type: Schema.Types.ObjectId,
        ref: 'User'
    }],
    nextCollector: {
        type: Schema.Types.ObjectId,
        ref: 'User'
    },
    createdBy: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    description: {
        type: String,
        trim: true
    },
    status: {
        type: String,
        enum: ['active', 'pending', 'completed', 'cancelled'],
        default: 'active'
    },
    currentRound: {
        type: Number,
        default: 1
    },
    payments: [paymentSchema]
}, { timestamps: true });

module.exports = mongoose.model('Group', groupSchema);
