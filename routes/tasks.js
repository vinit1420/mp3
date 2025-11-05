const express = require('express');
const router = express.Router();
const Task = require('../models/task');
const User = require('../models/user');

function parseJSON(str, fallback) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function ok(message, data) {
  return { message, data };
}
function errMsg(message, data = null) {
  return { message, data };
}

// GET /api/tasks
router.get('/', async (req, res) => {
  try {
    const where = parseJSON(req.query.where, {});
    const sort = parseJSON(req.query.sort, null);
    const select = parseJSON(req.query.select, null);
    const filter = parseJSON(req.query.filter, null);
    const skip = req.query.skip ? Number(req.query.skip) : 0;
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const count = req.query.count === 'true';

    if (count) {
      const c = await Task.countDocuments(where);
      return res.status(200).json(ok('OK', c));
    }

    let q = Task.find(where);
    if (sort) q = q.sort(sort);

    if (filter) {
      q = q.select(filter);
    } else if (select) {
      q = q.select(select);
    }

    if (skip) q = q.skip(skip);
    if (limit) q = q.limit(limit);

    const tasks = await q.exec();
    return res.status(200).json(ok('OK', tasks));
  } catch (err) {
    console.error('GET /api/tasks error:', err);
    return res
      .status(500)
      .json(errMsg('Failed to fetch tasks. Please try again later.', []));
  }
});

// POST /api/tasks
router.post('/', async (req, res) => {
  try {
    console.log('POST /api/tasks body:', req.body);

    const { name, deadline } = req.body;

    if (!name || !deadline) {
      return res
        .status(400)
        .json(errMsg('Task name and deadline are required.', null));
    }

    const assignedUser = req.body.assignedUser || null;
    let assignedUserName = 'unassigned';

    if (assignedUser) {
      const user = await User.findById(assignedUser);
      if (!user) {
        return res
          .status(400)
          .json(errMsg('Assigned user not found.', null));
      }
      assignedUserName = user.name;
    }

    const payload = {
      name,
      description: req.body.description || '',
      deadline: req.body.deadline,
      completed: req.body.completed ?? false,
      assignedUser: assignedUser,
      assignedUserName
    };

    const task = await Task.create(payload);

    // two-way: if assigned, add to user's pendingTasks
    if (assignedUser) {
      await User.findByIdAndUpdate(assignedUser, {
        $addToSet: { pendingTasks: task._id }
      });
    }

    return res.status(201).json(ok('Task created successfully.', task));
  } catch (err) {
    console.error('Error creating task:', err);
    return res
      .status(500)
      .json(errMsg('Could not create task at the moment.', null));
  }
});

// GET /api/tasks/:id
router.get('/:id', async (req, res) => {
  try {
    const select = parseJSON(req.query.select, null);
    let q = Task.findById(req.params.id);
    if (select) q = q.select(select);

    const task = await q.exec();
    if (!task) {
      return res.status(404).json(errMsg('Task not found.', null));
    }

    return res.status(200).json(ok('OK', task));
  } catch (err) {
    return res.status(400).json(errMsg('Invalid task id.', null));
  }
});

// PUT /api/tasks/:id
// must keep task ↔ user in sync
router.put('/:id', async (req, res) => {
  try {
    const taskId = req.params.id;
    const task = await Task.findById(taskId);

    if (!task) {
      return res.status(404).json(errMsg('Task not found.', null));
    }

    const {
      name,
      description,
      deadline,
      completed,
      assignedUser
    } = req.body;

    // validate required fields if sent
    if (typeof name !== 'undefined' && !name) {
      return res
        .status(400)
        .json(errMsg('Task name cannot be empty.', null));
    }
    if (typeof deadline !== 'undefined' && !deadline) {
      return res
        .status(400)
        .json(errMsg('Task deadline cannot be empty.', null));
    }

    const oldAssignedUser = task.assignedUser
      ? task.assignedUser.toString()
      : null;

    if (typeof name !== 'undefined') task.name = name;
    if (typeof description !== 'undefined') task.description = description;
    if (typeof deadline !== 'undefined') task.deadline = deadline;
    if (typeof completed !== 'undefined') task.completed = completed;

    // handle assignment changes
    if (typeof assignedUser !== 'undefined') {
      if (assignedUser) {
        const user = await User.findById(assignedUser);
        if (!user) {
          return res
            .status(400)
            .json(errMsg('Assigned user not found.', null));
        }
        task.assignedUser = assignedUser;
        task.assignedUserName = user.name;
      } else {
        // unassign
        task.assignedUser = null;
        task.assignedUserName = 'unassigned';
      }
    }

    await task.save();

    // sync user.pendingTasks if assignment changed
    const newAssignedUser = task.assignedUser
      ? task.assignedUser.toString()
      : null;

    if (oldAssignedUser && oldAssignedUser !== newAssignedUser) {
      await User.findByIdAndUpdate(oldAssignedUser, {
        $pull: { pendingTasks: task._id }
      });
    }
    if (newAssignedUser && oldAssignedUser !== newAssignedUser) {
      await User.findByIdAndUpdate(newAssignedUser, {
        $addToSet: { pendingTasks: task._id }
      });
    }

    return res.status(200).json(ok('Task updated successfully.', task));
  } catch (err) {
    console.error('PUT /api/tasks/:id error:', err);
    return res
      .status(500)
      .json(errMsg('Could not update task at the moment.', null));
  }
});

// DELETE /api/tasks/:id
// must remove task from its assigned user's pendingTasks
router.delete('/:id', async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);

    if (!task) {
      return res.status(404).json(errMsg('Task not found.', null));
    }

    const assignedUser = task.assignedUser;

    await Task.findByIdAndDelete(task._id);

    if (assignedUser) {
      await User.findByIdAndUpdate(assignedUser, {
        $pull: { pendingTasks: task._id }
      });
    }

    // return 200 with a message
    return res.status(200).json(
      ok('Task deleted successfully.', {
        _id: task._id,
        name: task.name,
        assignedUser: task.assignedUser,
        assignedUserName: task.assignedUserName
      })
    );
  } catch (err) {
    console.error('DELETE /api/tasks/:id error:', err);
    return res
      .status(500)
      .json(errMsg('Could not delete task at the moment.', null));
  }
});

module.exports = router;
