const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const userSchema = new Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true, 
        trim: true
    },
    password: {
        type: String,
        required: true
    },
    phone: {
        type: String,
        required: true,
        trim: true
    },
    accountNumber: {
        type: String,
        trim: true
    },
    bankName: {
        type: String,
        trim: true
    },
    groups: [{ 
        type: Schema.Types.ObjectId,
        ref: 'Group'
    }]
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

module.exports = User;