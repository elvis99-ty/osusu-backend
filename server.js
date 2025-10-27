const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const User = require('./models/user.model');
const Group = require('./models/group.model');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const auth = require('./middleware/auth.middleware');
const axios = require('axios');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4009;


// Middleware
app.use(cors({
    origin: ["https://osusu-frontend.vercel.app"],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
}));
app.use(express.json());

app.get('/', (req, res) => {
    res.send('SuSuFlow API is running');
});


// ✅ Register route
app.post("/api/users/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;   // 🔹 expect `name`

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({ name, email, password: hashedPassword });
    await newUser.save();

    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    console.error("Register error:",error);
    res.status(500).json({ message:  error.message || "Failed to register User" });
  }
});

// ✅ Login route
app.post("/api/users/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) return res.status(400).json({ message: "Invalid credentials" });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "1h" });

    res.json({
      token,
      user: { id: user._id, name: user.name, email: user.email }, // 🔹 send `name`
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to login User" });
  }
});

// --- END UPDATED LOGIN ROUTE ---

// --- UPDATED USER PROFILE ROUTE ---
app.get('/api/users/profile', auth, async (req, res) => {
    try {
        const user = await User.findById(req.userId).select('-password');

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.status(200).json({
            _id: user._id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            accountNumber: user.accountNumber,
            bankName: user.bankName,
            isAdmin: user.isAdmin,
        });
    } catch (error) {
        console.error('Error fetching profile:', error);
        res.status(500).json({ message: 'Failed to fetch profile' });
    }
});
// --- END UPDATED USER PROFILE ROUTE ---

// --- UPDATED GROUP CREATE ROUTE ---
app.post('/api/groups/create', auth, async (req, res) => {
    try {
        const { name, contributionAmount, memberLimit, frequency, startDate, description } = req.body;
        const creatorId = req.userId;

        const creatorUser = await User.findById(creatorId);
        if (!creatorUser) {
            return res.status(404).json({ message: 'Creator user not found.' });
        }

        if (!name || !contributionAmount || !memberLimit || !frequency || !startDate) {
            return res.status(400).json({ message: 'Please provide all required group information' });
        }

        if (parseInt(memberLimit, 10) < 2) {
            return res.status(400).json({ message: 'Member limit must be at least 2.' });
        }

        const initialMembers = [{
            userId: creatorId,
            email: creatorUser.email,
            joinedAt: new Date(),
            isCreator: true
        }];
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
// --- END UPDATED GROUP CREATE ROUTE ---

// --- UPDATED GROUP JOIN REQUEST ROUTE ---
app.post('/api/groups/:groupId/request-join', auth, async (req, res) => {
    try {
        const groupId = req.params.groupId;
        const userId = req.userId;

        const group = await Group.findById(groupId);

        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        if (group.members.some(memberObj => memberObj.userId.toString() === userId.toString())) {
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
// --- END UPDATED GROUP JOIN REQUEST ROUTE ---

// --- UPDATED GROUP APPROVE JOIN ROUTE ---
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

        const requestedUser = await User.findById(group.pendingRequests[requestIndex].userId);
        if (!requestedUser) {
            return res.status(404).json({ message: 'User associated with join request not found.' });
        }

        group.members.push({
            userId: requestedUser._id,
            email: requestedUser.email,
            joinedAt: new Date(),
            isCreator: false
        });
        group.collectionOrder.push(requestedUser._id);
        group.pendingRequests.splice(requestIndex, 1);

        if (group.nextCollector === null) {
            const nonCreatorMembers = group.members.filter(memberObj => memberObj.userId.toString() !== group.createdBy.toString());

            if (nonCreatorMembers.length > 0) {
                const randomIndex = Math.floor(Math.random() * nonCreatorMembers.length);
                group.nextCollector = nonCreatorMembers[randomIndex].userId;
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
// --- END UPDATED GROUP APPROVE JOIN ROUTE ---

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


// --- UPDATED GET GROUPS ROUTE ---
app.get('/api/groups', auth, async (req, res) => {
    try {
        const groups = await Group.find()
            .populate('members.userId', 'name email')
            .populate('pendingRequests.userId', 'name email')
            .populate('createdBy', 'name email');
        res.status(200).json(groups);
    } catch (error) {
        console.error('Error fetching groups:', error);
        res.status(500).json({ message: 'Failed to fetch groups' });
    }
});
// --- END UPDATED GET GROUPS ROUTE ---

// --- UPDATED GET GROUP BY ID ROUTE ---
app.get('/api/groups/:groupId', auth, async (req, res) => {
    try {
        const groupId = req.params.groupId;

        const group = await Group.findById(groupId)
            .populate('members.userId', 'name email')
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
// --- END UPDATED GET GROUP BY ID ROUTE ---

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

// --- UPDATED GET USER GROUPS ROUTE ---
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
                    path: 'members.userId nextCollector createdBy',
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

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.error('MongoDB connection error :', err));

// Start Server
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
