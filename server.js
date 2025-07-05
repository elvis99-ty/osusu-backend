const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const User = require('./models/user.model');
const Group = require('./models/group.model');
const PaymentSchema = require('./models/payment.schema');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const auth = require('./middleware/auth.middleware');
const axios = require('axios');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4009;

// Middleware
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('SuSuFlow API is running');
});


app.post('/api/users/register', async (req, res) => {
    try {
        const { name, email, password, phone, accountNumber, bankName } = req.body;

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'Email already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = new User({
            name,
            email,
            password: hashedPassword,
            phone,
            accountNumber,
            bankName,
        });

        await newUser.save();
        res.status(201).json({ message: 'User registered successfully' });
    } catch (error) {
        console.error('Error registering User:', error);
        res.status(500).json({ message: 'Failed to register User' });
    }
});

app.post('/api/users/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email });

        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1hr' });
        res.status(200).json({ message: 'Logged in successfully', token });
    } catch (error) {
        console.error('Error logging in:', error);
        res.status(500).json({ message: 'Failed to log in' });
    }
});

app.get('/api/users/profile', auth, async (req, res) => {
    try {
        const user = await User.findById(req.userId).select('-password');

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.status(200).json(user);
    } catch (error) {
        console.error('Error fetching profile:', error);
        res.status(500).json({ message: 'Failed to fetch profile' });
    }
});

app.post('/api/groups/create', auth, async (req, res) => {
    try {
        const { name, contributionAmount, memberLimit, frequency, startDate, description } = req.body;
        const creatorId = req.userId;

        if (!name || !contributionAmount || !memberLimit || !frequency || !startDate) {
            return res.status(400).json({ message: 'Please provide all required group information' });
        }

        if (parseInt(memberLimit, 10) < 2) {
            return res.status(400).json({ message: 'Member limit must be at least 2.' });
        }

        const initialMembers = [creatorId];
        const collectionOrder = [creatorId];

        const newGroup = new Group({
            name,
            members: initialMembers,
            pendingRequests: [],
            contributionAmount: parseFloat(contributionAmount),
            memberLimit: parseInt(memberLimit, 10),
            cycleFrequency: frequency,
            startDate: new Date(startDate),
            collectionOrder,
            nextCollector: null,
            createdBy: creatorId,
            description: description || '',
            status: 'active',
            currentRound: 1
        });

        const savedGroup = await newGroup.save();

        await User.findByIdAndUpdate(
            creatorId,
            { $push: { groups: savedGroup._id } },
            { new: true, useFindAndModify: false }
        );

        res.status(201).json({ message: 'Group created successfully!', group: savedGroup });
    } catch (error) {
        console.error('Error creating group:', error);
        res.status(500).json({ message: 'Failed to create group', error: error.message });
    }
});

app.post('/api/groups/:groupId/request-join', auth, async (req, res) => {
    try {
        const groupId = req.params.groupId;
        const userId = req.userId;

        const group = await Group.findById(groupId);

        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        if (group.members.some(memberId => memberId.toString() === userId.toString())) {
            return res.status(400).json({ message: 'You are already a member of this group.' });
        }

        if (group.pendingRequests.some(pendingReq => pendingReq.userId.toString() === userId.toString())) {
            return res.status(400).json({ message: 'You have already sent a join request to this group.' });
        }

        if (group.members.length >= group.memberLimit) {
            return res.status(400).json({ message: 'This group has reached its member limit.' });
        }

        group.pendingRequests.push({ userId: userId, timestamp: new Date() });
        await group.save();

        res.status(200).json({ message: 'Your request to join the group has been sent for approval.' });
    } catch (error) {
        console.error('Error sending join request:', error);
        if (error.name === 'CastError') {
            return res.status(400).json({ message: 'Invalid Group ID format.' });
        }
        res.status(500).json({ message: 'Failed to send join request.' });
    }
});

app.post('/api/groups/:groupId/approve-join/:requestId', auth, async (req, res) => {
    try {
        const { groupId, requestId } = req.params;
        const creatorId = req.userId;

        const group = await Group.findById(groupId);

        if (!group) {
            return res.status(404).json({ message: 'Group not found.' });
        }

        if (group.createdBy.toString() !== creatorId.toString()) {
            return res.status(403).json({ message: 'Unauthorized: Only the group creator can approve requests.' });
        }

        const requestIndex = group.pendingRequests.findIndex(
            pendingReq => pendingReq.userId.toString() === requestId.toString()
        );

        if (requestIndex === -1) {
            return res.status(404).json({ message: 'Join request not found or already processed.' });
        }


        const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;
        if ((new Date() - new Date(group.pendingRequests[requestIndex].timestamp)) > ONE_DAY_IN_MS) {
            group.pendingRequests.splice(requestIndex, 1);
            await group.save();
            return res.status(400).json({ message: 'This join request has expired and cannot be approved.' });
        }

        if (group.members.length >= group.memberLimit) {
            group.pendingRequests.splice(requestIndex, 1);
            await group.save();
            return res.status(400).json({ message: 'Group is already full. Cannot approve new members.' });
        }

        group.members.push(group.pendingRequests[requestIndex].userId);
        group.collectionOrder.push(group.pendingRequests[requestIndex].userId);
        group.pendingRequests.splice(requestIndex, 1);

        if (group.nextCollector === null) {
            const nonCreatorMembers = group.members.filter(memberId => memberId.toString() !== group.createdBy.toString());

            if (nonCreatorMembers.length > 0) {
                const randomIndex = Math.floor(Math.random() * nonCreatorMembers.length);
                group.nextCollector = nonCreatorMembers[randomIndex];
            } else {
                group.nextCollector = group.createdBy;
            }
        }

        await group.save();

        await User.findByIdAndUpdate(
            requestId,
            { $push: { groups: group._id } },
            { new: true, useFindAndModify: false }
        );

        res.status(200).json({ message: 'Join request approved successfully!', group });
    } catch (error) {
        console.error('Error approving join request:', error);
        if (error.name === 'CastError') {
            return res.status(400).json({ message: 'Invalid Group ID or Request ID format.' });
        }
        res.status(500).json({ message: 'Failed to approve join request.' });
    }
});

app.post('/api/groups/:groupId/reject-join/:requestId', auth, async (req, res) => {
    try {
        const { groupId, requestId } = req.params;
        const creatorId = req.userId;

        const group = await Group.findById(groupId);

        if (!group) {
            return res.status(404).json({ message: 'Group not found.' });
        }

        if (group.createdBy.toString() !== creatorId.toString()) {
            return res.status(403).json({ message: 'Unauthorized: Only the group creator can reject requests.' });
        }

        const requestIndex = group.pendingRequests.findIndex(
            pendingReq => pendingReq.userId.toString() === requestId.toString()
        );

        if (requestIndex === -1) {
            return res.status(404).json({ message: 'Join request not found or already processed.' });
        }

        const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;
        if ((new Date() - new Date(group.pendingRequests[requestIndex].timestamp)) > ONE_DAY_IN_MS) {
            group.pendingRequests.splice(requestIndex, 1);
            await group.save();
            return res.status(400).json({ message: 'This join request has expired and cannot be rejected.' });
        }

        group.pendingRequests.splice(requestIndex, 1);
        await group.save();

        res.status(200).json({ message: 'Join request rejected successfully!', group });
    } catch (error) {
        console.error('Error rejecting join request:', error);
        if (error.name === 'CastError') {
            return res.status(400).json({ message: 'Invalid Group ID or Request ID format.' });
        }
        res.status(500).json({ message: 'Failed to reject join request.' });
    }
});


app.get('/api/groups', auth, async (req, res) => {
    try {
        const groups = await Group.find()
            .populate('members', 'name email')
        .populate('pendingRequests.userId', 'name email') 
            .populate('createdBy', 'name email');
        res.status(200).json(groups);
    } catch (error) {
        console.error('Error fetching groups:', error);
        res.status(500).json({ message: 'Failed to fetch groups' });
    }
});

app.get('/api/groups/:groupId', auth, async (req, res) => {
    try {
        const groupId = req.params.groupId;

        const group = await Group.findById(groupId)
            .populate('members', 'name email')
            .populate('createdBy', 'name email')
            .populate('pendingRequests.userId', 'name email'); 
            
        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        res.status(200).json(group);
    } catch (error) {
        console.error('Error fetching group:', error);
        if (error.name === 'CastError') {
            return res.status(400).json({ message: 'Invalid Group ID format' });
        }
        res.status(500).json({ message: 'Failed to fetch group' });
    }
});

app.get('/api/groups/:groupId/payments', auth, async(req, res) => {
    try {
        const groupId = req.params.groupId;

        const group = await Group.findById(groupId);

        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        const payments = group.payments;
        res.status(200).json(payments);

    } catch (error) {
        console.error('Error fetching payments for group:', error);
        if (error.name === 'CastError') {
            return res.status(400).json({ message: 'Invalid Group ID format.' });
        }
        res.status(500).json({ message: 'Failed to fetch payments for group' });
    }
});

app.get('/api/users/:userId/groups', auth, async (req, res) => {
    try {
        const userId = req.params.userId;

        if (req.userId.toString() !== userId.toString()) {
            return res.status(403).json({ message: 'Unauthorized access to user groups.' });
        }

        const user = await User.findById(userId).populate({
            path: 'groups',
            populate: [
                {
                    path: 'members nextCollector createdBy',
                    select: 'name email phone'
                },
                {
                    path: 'pendingRequests.userId',
                    select: 'name email phone'
                }
            ]
        });

        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        const userGroups = user.groups.map(group => ({
            _id: group._id,
            name: group.name,
            contributionAmount: group.contributionAmount,
            cycleFrequency: group.cycleFrequency,
            startDate: group.startDate,
            memberLimit: group.memberLimit,
            currentRound: group.currentRound,
            nextCollector: group.nextCollector,
            status: group.status,
            members: group.members,
            pendingRequests: group.pendingRequests,
            isCreator: group.createdBy._id.toString() === userId.toString(),
        }));

        res.status(200).json(userGroups);
    } catch (error) {
        console.error('Error fetching user groups:', error);
        res.status(500).json({ message: 'Failed to fetch user groups.', error: error.message });
    }
});


app.post('/api/payments/initialize/:groupId', auth, async (req, res) => {
    try {
        const groupId = req.params.groupId;
        const userId = req.userId;
        const { amount } = req.body;

        const objectIdGroupId = new mongoose.Types.ObjectId(groupId);

        const user = await User.findById(userId);
        if (!user) {
            console.error("Error: Authenticated user not found for ID:", userId);
            return res.status(404).json({ message: 'Authenticated user not found.' });
        }

        const group = await Group.findById(objectIdGroupId);
        if (!group) {
            console.error("Error: Group not found for ID:", groupId);
            return res.status(404).json({ message: 'Group not found' });
        }

        if (!group.members.map(m => m.toString()).includes(userId.toString())) {
            console.error("Error: User is not a member of this group. User ID:", userId, "Group Members:", group.members);
            return res.status(403).json({ message: 'User is not a member of this group' });
        }

        const recipient = group.nextCollector;
        if (!recipient) {
            console.error("Error: No next collector found for this group.");
            return res.status(400).json({ message: 'No next collector found for this group.' });
        }

        if (recipient.toString() === userId.toString()) {
            console.error("Error: Cannot initialize payment to yourself. Payer:", userId, "Recipient:", recipient);
            return res.status(400).json({ message: 'Cannot initialize payment to yourself.' });
        }

        const flutterwave_url = "https://api.flutterwave.com/v3/payments";
        const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY;

        if (!FLW_SECRET_KEY) {
            console.error("Error: Flutterwave secret key is not configured in .env");
            return res.status(500).json({ message: 'Flutterwave secret key is not configured' });
        }

        const transaction_ref = `TX-${Date.now()}-${Math.random().toString(36).substring(7)}`;

        const payload = {
            tx_ref: transaction_ref,
            amount: amount,
            currency: "NGN",
            customer: {
                email: user.email,
                phonenumber: user.phone,
                name: user.name,
            },
            redirect_url: `${process.env.BACKEND_URL}/api/payments/verify`,
        };

        const headers = {
            Authorization: `Bearer ${FLW_SECRET_KEY}`,
            "Content-Type": "application/json",
        };

        try {
            const response = await axios.post(flutterwave_url, payload, { headers: headers });
            const data = response.data;

            if (data.status !== "success") {
                console.error("Flutterwave Error (status not 'success'):", JSON.stringify(data, null, 2));
                return res.status(500).json({ message: 'Failed to initialize payment with Flutterwave', flutterwave_error: data });
            }

            const newPaymentData = {
                payer: userId,
                recipient: recipient,
                amount: amount,
                round: group.currentRound,
                paymentDate: new Date(),
                status: 'Pending',
                paymentReference: transaction_ref,
            };

            const paymentSubdocument = new mongoose.Document(newPaymentData, PaymentSchema);

            group.payments.push(paymentSubdocument);
            await group.save();

            const authorization_url = data.data.link;

            res.status(200).json({
                message: 'Payment initialized successfully',
                authorization_url: authorization_url,
                paymentReference: transaction_ref,
                payment: newPaymentData
            });

        } catch (error) {
            console.error('Error during Flutterwave API call:', error);
            if (error.response) {
                console.error("Axios Error Response Data:", JSON.stringify(error.response.data, null, 2));
                console.error("Axios Error Response Status:", error.response.status);
                console.error("Axios Error Response Headers:", error.response.headers);
            } else if (error.request) {
                console.error("Axios Error Request (no response received):", error.request);
            } else {
                console.error("Axios Error Message:", error.message);
            }
            res.status(500).json({ message: 'Failed to initialize payment', error: error.message });
        }
    } catch (error) {
        console.error('Unhandled Error in /api/payments/initialize:', error);
        res.status(500).json({ message: 'Failed to initialize payment', error: error.message });
    }
});


app.post('/api/payments/verify', auth, async (req, res) => {
    try {
        const { transaction_id, tx_ref } = req.body;

        if (!transaction_id) {
            return res.status(400).json({ message: 'Transaction ID is required for verification.' });
        }

        const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY;
        const verificationUrl = `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`;

        let verificationData;

        if (transaction_id === "DUMMY_FLUTTERWAVE_TX_ID_12345") {
            console.warn("MOCKING FLUTTERWAVE VERIFICATION: Using dummy transaction ID.");
            verificationData = {
                status: 'success',
                data: {
                    status: 'successful',
                    amount: 1000,
                    currency: 'NGN',
                    tx_ref: tx_ref,
                }
            };
        } else {
            const headers = {
                Authorization: `Bearer ${FLW_SECRET_KEY}`,
            };
            const response = await axios.get(verificationUrl, { headers });
            verificationData = response.data;
        }

        if (verificationData.status === 'success' && verificationData.data.status === 'successful') {
            const group = await Group.findOne({ "payments.paymentReference": tx_ref });

            if (!group) {
                console.error("Group containing payment record not found for reference:", tx_ref);
                return res.status(404).json({ message: 'Payment record not found (group not found).' });
            }

            const payment = group.payments.find(p => p.paymentReference === tx_ref);

            if (!payment) {
                console.error("Payment subdocument not found within group for reference:", tx_ref);
                return res.status(404).json({ message: 'Payment record not found (subdocument not found).' });
            }

            payment.status = 'Complete';

            const payerIdFromPayment = payment.payer;

            const currentIndex = group.collectionOrder.findIndex(member => member.toString() === payerIdFromPayment.toString());
            
            if (currentIndex !== -1) {
                const nextIndex = (currentIndex + 1) % group.collectionOrder.length;
                group.nextCollector = group.collectionOrder[nextIndex];

                if (nextIndex === 0) {
                    group.currentRound += 1;
                    if (group.currentRound > group.members.length) {
                        group.status = 'Completed';
                    }
                }
                await group.save();
            } else {
                console.warn("Payer not found in group's collectionOrder. Next collector not advanced.");
                await group.save();
            }

            return res.status(200).json({ message: 'Payment verified successfully, and group updated.', payment });
        } else {
            console.error("Flutterwave verification failed:", verificationData);
            return res.status(400).json({ message: 'Payment verification failed.', verificationData });
        }
    } catch (error) {
        console.error("Error verifying payment:", error);
        res.status(500).json({ message: 'Failed to verify payment.', error: error.message });
    }
});

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.error('MongoDB connection error :', err));

// Start Server
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});