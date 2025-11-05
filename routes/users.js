// routes/users.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');          // 👈 needed for ObjectId.isValid
const User = require('../models/user');
const Task = require('../models/task');        // 👈 needed for two-way sync

function parseJSON(str, fallback) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

// ============ GET all users ============
router.get('/', async (req, res) => {
  try {
    const where = parseJSON(req.query.where, {});
    const sort = parseJSON(req.query.sort, null);
    const select = parseJSON(req.query.select, null);
    const filter = parseJSON(req.query.filter, null);
    const skip = req.query.skip ? Number(req.query.skip) : 0;
    const limit = req.query.limit ? Number(req.query.limit) : 0;
    const count = req.query.count === 'true';

    if (count) {
      const c = await User.countDocuments(where);
      return res.status(200).json({ message: 'OK', data: c });
    }

    let q = User.find(where);
    if (sort) q = q.sort(sort);
    if (filter) q = q.select(filter);
    else if (select) q = q.select(select);
    if (skip) q = q.skip(skip);
    if (limit) q = q.limit(limit);

    const users = await q.exec();
    return res.status(200).json({ message: 'OK', data: users });
  } catch (err) {
    console.error('GET /api/users error:', err);
    return res.status(500).json({
      message: 'Failed to fetch users. Please try again later.',
      data: []
    });
  }
});

// ============ GET one user ============
router.get('/:id', async (req, res) => {
  try {
    const u = await User.findById(req.params.id);
    if (!u) {
      return res.status(404).json({ message: 'User not found.', data: null });
    }
    return res.status(200).json({ message: 'OK', data: u });
  } catch (err) {
    return res.status(400).json({ message: 'Invalid user id.', data: null });
  }
});

// ============ POST user ============
router.post('/', async (req, res) => {
  try {
    const name = req.body.name || '';
    const email = req.body.email || '';
    const pendingTasks = Array.isArray(req.body.pendingTasks)
      ? req.body.pendingTasks
      : [];

    if (!name || !email) {
      return res
        .status(400)
        .json({ message: 'Name and email are required to create a user.', data: null });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res
        .status(400)
        .json({ message: 'A user with this email already exists.', data: null });
    }

    const user = await User.create({
      name,
      email,
      pendingTasks
    });

    // if user was created with tasks, make tasks point to user
    if (pendingTasks.length > 0) {
      await Task.updateMany(
        { _id: { $in: pendingTasks } },
        { $set: { assignedUser: user._id, assignedUserName: user.name } }
      );
    }

    return res.status(201).json({
      message: 'User created successfully.',
      data: user
    });
  } catch (err) {
    console.error('POST /api/users error:', err);
    return res.status(500).json({
      message: 'Could not create user at the moment.',
      data: null
    });
  }
});

// ============ STRICT PUT user ============
router.put('/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    const { name, email, pendingTasks } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found.', data: null });
    }

    // basic fields
    if (typeof name !== 'undefined') {
      if (!name) {
        return res
          .status(400)
          .json({ message: 'User name cannot be empty.', data: null });
      }
      user.name = name;
    }

    if (typeof email !== 'undefined') {
      if (!email) {
        return res
          .status(400)
          .json({ message: 'User email cannot be empty.', data: null });
      }
      const emailOwner = await User.findOne({
        email: email.toLowerCase(),
        _id: { $ne: userId }
      });
      if (emailOwner) {
        return res
          .status(400)
          .json({ message: 'Another user with this email already exists.', data: null });
      }
      user.email = email.toLowerCase();
    }

    // handle pendingTasks strictly
    if (Array.isArray(pendingTasks)) {
      // 1) validate ObjectIds
      const invalidIds = pendingTasks.filter(
        (id) => !mongoose.Types.ObjectId.isValid(id)
      );
      if (invalidIds.length > 0) {
        return res.status(400).json({
          message: 'Some task ids are not valid ObjectIds: ' + invalidIds.join(', '),
          data: null
        });
      }

      // 2) fetch all existing tasks
      const tasks = await Task.find({ _id: { $in: pendingTasks } })
        .select('_id')
        .lean();

      const foundIds = tasks.map((t) => t._id.toString());
      const requestedIds = pendingTasks.map((id) => id.toString());

      // 3) if any requested is missing → 400
      if (foundIds.length !== requestedIds.length) {
        const missing = requestedIds.filter((id) => !foundIds.includes(id));
        return res.status(400).json({
          message: 'Some tasks do not exist: ' + missing.join(', '),
          data: null
        });
      }

      // 4) sync user
      user.pendingTasks = requestedIds;

      // 5) make these tasks point to user
      await Task.updateMany(
        { _id: { $in: requestedIds } },
        { $set: { assignedUser: user._id, assignedUserName: user.name } }
      );

      // 6) unassign old tasks
      await Task.updateMany(
        {
          assignedUser: user._id,
          _id: { $nin: requestedIds }
        },
        { $set: { assignedUser: null, assignedUserName: 'unassigned' } }
      );
    }

    await user.save();
    return res.status(200).json({
      message: 'User updated successfully.',
      data: user
    });
  } catch (err) {
    console.error('PUT /api/users/:id error:', err);
    return res.status(500).json({
      message: 'Could not update user at the moment.',
      data: null
    });
  }
});

// ============ DELETE user (unassign tasks) ============
router.delete('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found', data: null });
    }

    await Task.updateMany(
      { assignedUser: user._id },
      { $set: { assignedUser: null, assignedUserName: 'unassigned' } }
    );

    await User.findByIdAndDelete(user._id);

    return res.status(204).send();
  } catch (err) {
    console.error('DELETE /api/users/:id error:', err);
    return res.status(500).json({
      message: 'Could not delete user at the moment.',
      data: null
    });
  }
});

module.exports = router;
