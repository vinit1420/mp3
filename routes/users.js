const express = require('express');
const router = express.Router();
const User = require('../models/user');
const Task = require('../models/task'); // needed for two-way syncing

function parseJSON(str, fallback) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

// simple helpers so every response is { message, data }
function ok(message, data) {
  return { message, data };
}
function errMsg(message, data = null) {
  return { message, data };
}

// GET /api/users
router.get('/', async (req, res) => {
  try {
    const where = parseJSON(req.query.where, {});
    const sort = parseJSON(req.query.sort, null);
    const select = parseJSON(req.query.select, null);
    const filter = parseJSON(req.query.filter, null);  // backward compat
    const skip = req.query.skip ? Number(req.query.skip) : 0;
    const limit = req.query.limit ? Number(req.query.limit) : 0;
    const count = req.query.count === 'true';

    if (count) {
      const c = await User.countDocuments(where);
      return res.status(200).json(ok('OK', c));
    }

    let q = User.find(where);
    if (sort) q = q.sort(sort);

    // script uses ?filter={"_id":1}
    if (filter) {
      q = q.select(filter);
    } else if (select) {
      q = q.select(select);
    }

    if (skip) q = q.skip(skip);
    if (limit) q = q.limit(limit);

    const users = await q.exec();
    return res.status(200).json(ok('OK', users));
  } catch (err) {
    console.error('GET /api/users error:', err);
    return res
      .status(500)
      .json(errMsg('Failed to fetch users. Please try again later.', []));
  }
});

// GET /api/users/:id
router.get('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).exec();
    if (!user) {
      return res.status(404).json(errMsg('User not found.', null));
    }
    return res.status(200).json(ok('OK', user));
  } catch (err) {
    return res.status(400).json(errMsg('Invalid user id.', null));
  }
});

// POST /api/users
router.post('/', async (req, res) => {
  try {
    const name = req.body.name;
    const email = req.body.email;
    const pendingTasks = Array.isArray(req.body.pendingTasks)
      ? req.body.pendingTasks
      : [];

    if (!name || !email) {
      return res
        .status(400)
        .json(errMsg('Name and email are required to create a user.', null));
    }

    // enforce unique email at API level (in addition to schema)
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res
        .status(400)
        .json(errMsg('A user with this email already exists.', null));
    }

    const user = await User.create({
      name,
      email,
      pendingTasks
    });

    // if user was created with pendingTasks, make sure every task points back
    if (pendingTasks.length > 0) {
      await Task.updateMany(
        { _id: { $in: pendingTasks } },
        { $set: { assignedUser: user._id, assignedUserName: user.name } }
      );
    }

    return res
      .status(201)
      .json(ok('User created successfully.', user));
  } catch (err) {
    console.error('POST /api/users error:', err);
    return res
      .status(500)
      .json(errMsg('Could not create user at the moment.', null));
  }
});

// PUT /api/users/:id
// must allow updating pendingTasks and keep tasks in sync
router.put('/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    const { name, email, pendingTasks } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json(errMsg('User not found.', null));
    }

    if (typeof name !== 'undefined') {
      if (!name) {
        return res
          .status(400)
          .json(errMsg('User name cannot be empty.', null));
      }
      user.name = name;
    }

    if (typeof email !== 'undefined') {
      if (!email) {
        return res
          .status(400)
          .json(errMsg('User email cannot be empty.', null));
      }
      const emailOwner = await User.findOne({
        email: email.toLowerCase(),
        _id: { $ne: userId }
      });
      if (emailOwner) {
        return res
          .status(400)
          .json(errMsg('Another user with this email already exists.', null));
      }
      user.email = email.toLowerCase();
    }

    // if pendingTasks sent, sync tasks ↔ user
    if (Array.isArray(pendingTasks)) {
      user.pendingTasks = pendingTasks;

      // set these tasks to this user
      await Task.updateMany(
        { _id: { $in: pendingTasks } },
        { $set: { assignedUser: user._id, assignedUserName: user.name } }
      );

      // unassign tasks that used to belong to this user but were removed
      await Task.updateMany(
        {
          assignedUser: user._id,
          _id: { $nin: pendingTasks }
        },
        { $set: { assignedUser: null, assignedUserName: 'unassigned' } }
      );
    }

    await user.save();
    return res.status(200).json(ok('User updated successfully.', user));
  } catch (err) {
    console.error('PUT /api/users/:id error:', err);
    return res
      .status(500)
      .json(errMsg('Could not update user at the moment.', null));
  }
});

// DELETE /api/users/:id
// must unassign the user's pending tasks
router.delete('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json(errMsg('User not found.', null));
    }

    // unassign all tasks assigned to this user
    await Task.updateMany(
      { assignedUser: user._id },
      { $set: { assignedUser: null, assignedUserName: 'unassigned' } }
    );

    await User.findByIdAndDelete(user._id);

    // 204: no content
    return res.status(204).send();
  } catch (err) {
    console.error('DELETE /api/users/:id error:', err);
    return res
      .status(500)
      .json(errMsg('Could not delete user at the moment.', null));
  }
});

module.exports = router;
