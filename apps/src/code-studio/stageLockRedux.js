/**
 * Reducer and actions for stage lock info. This includes the teacher panel on
 * the course overview page, and the stage locking dialog.
 */

import $ from 'jquery';
import _ from 'lodash';
import { makeEnum } from '@cdo/apps/utils';

export const ViewType = makeEnum('Student', 'Teacher');
export const LockStatus = makeEnum('Locked', 'Editable', 'ReadonlyAnswers');

// Action types
const SET_VIEW_TYPE = 'stageLock/SET_VIEW_TYPE';
export const SET_SECTIONS = 'stageLock/SET_SECTIONS';
export const SELECT_SECTION = 'stageLock/SELECT_SECTION';
const OPEN_LOCK_DIALOG = 'stageLock/OPEN_LOCK_DIALOG';
export const CLOSE_LOCK_DIALOG = 'stageLock/CLOSE_LOCK_DIALOG';
export const BEGIN_SAVE = 'stageLock/BEGIN_SAVE';
export const FINISH_SAVE = 'stageLock/FINISH_SAVE';
const AUTHORIZE_LOCKABLE = 'progress/AUTHORIZE_LOCKABLE';

export const initialState = {
  viewAs: ViewType.Student,
  sections: {},
  selectedSection: null,
  lockDialogStageId: null,
  // The locking info for the currently selected section/stage
  lockStatus: [],
  saving: false,
  // whether user is allowed to see lockable stages
  lockableAuthorized: false
};

/**
 * Stage lock reducer
 */
export default function reducer(state = initialState, action) {
  if (action.type === AUTHORIZE_LOCKABLE) {
    return Object.assign({}, state, {
      lockableAuthorized: true
    });
  }

  if (action.type === SET_VIEW_TYPE) {
    return Object.assign({}, state, {
      viewAs: action.viewAs
    });
  }

  if (action.type === SET_SECTIONS) {
    const sectionId = Object.keys(action.sections)[0];
    return Object.assign({}, state, {
      sections: action.sections,
      selectedSection: sectionId,
    });
  }

  if (action.type === SELECT_SECTION) {
    const sectionId = action.sectionId;
    if (!state.sections[sectionId]) {
      throw new Error(`Unknown sectionId ${sectionId}`);
    }
    // If we have a lockStatus (i.e. from an open dialog) we need to update
    // it with the new section
    const { lockDialogStageId, lockStatus } = state;
    return {
      ...state,
      selectedSection: sectionId,
      lockStatus: lockDialogStageId ?
        lockStatusForStage(state.sections[sectionId], lockDialogStageId) : lockStatus
    };
  }

  if (action.type === OPEN_LOCK_DIALOG) {
    const { sectionId, stageId } = action;
    return Object.assign({}, state, {
      lockDialogStageId: stageId,
      lockStatus: lockStatusForStage(state.sections[sectionId], stageId)
    });
  }

  if (action.type === CLOSE_LOCK_DIALOG) {
    return Object.assign({}, state, {
      lockDialogStageId: null,
      lockStatus: []
    });
  }

  if (action.type === BEGIN_SAVE) {
    return Object.assign({}, state, {
      saving: true
    });
  }

  if (action.type === FINISH_SAVE) {
    const { sections } = state;
    const { lockStatus: nextLockStatus, sectionId, stageId } = action;
    const nextStage = _.cloneDeep(sections[sectionId].stages[stageId]);

    // Update locked/readonly_answers in stages based on the new lockStatus provided
    // by our dialog.
    nextStage.forEach((item, index) => {
      const update = nextLockStatus[index];
      // We assume lockStatus is ordered the same as stageToUpdate. Let's
      // validate that.
      if (item.user_level_id !== update.userLevelId) {
        throw new Error('Expect user ids be the same');
      }
      item.locked = update.lockStatus === LockStatus.Locked;
      item.readonly_answers = update.lockStatus === LockStatus.ReadonlyAnswers;
    });

    const nextState = _.cloneDeep(state);
    nextState.sections[sectionId].stages[stageId] = nextStage;
    return Object.assign(nextState, {
      lockStatus: nextLockStatus,
      saving: false
    });
  }

  return state;
}

// Action creators

/**
 * Authorizes the user to be able to see lockable stages
 */
export const authorizeLockable = () => ({ type: AUTHORIZE_LOCKABLE });

export const setViewType = viewType => {
  if (!ViewType[viewType]) {
    throw new Error('unknown ViewType: ' + viewType);
  }

  return {
    type: SET_VIEW_TYPE,
    viewAs: viewType
  };
};

export const setSections = sections => ({
  type: SET_SECTIONS,
  sections
});

export const selectSection = sectionId => ({
  type: SELECT_SECTION,
  sectionId
});

export const openLockDialog = (sectionId, stageId) => ({
  type: OPEN_LOCK_DIALOG,
  sectionId,
  stageId
});

export const beginSave = () => ({ type: BEGIN_SAVE });
export const finishSave = (sectionId, stageId, newLockStatus) => ({
  type: FINISH_SAVE,
  sectionId,
  stageId,
  lockStatus: newLockStatus
});

/**
 * Action asynchronously dispatches a set of actions around saving our
 * lock status.
 */
const performSave = (newLockStatus, stageId, onComplete) => {
  return (dispatch, getState) => {
    const oldLockStatus = getState().stageLock.lockStatus;
    // TODO - pass in?
    const sectionId = getState().sections.selectedSection;

    const saveData = newLockStatus.filter((item, index) => {
      // Only need to save items that changed
      return !_.isEqual(item, oldLockStatus[index]);
    }).map(item => ({
      user_level_data: item.userLevelData,
      locked: item.lockStatus === LockStatus.Locked,
      readonly_answers: item.lockStatus === LockStatus.ReadonlyAnswers
    }));

    if (saveData.length === 0) {
      onComplete();
      return;
    }

    dispatch(beginSave());
    $.ajax({
      type: 'POST',
      url: '/api/lock_status',
      dataType: 'json',
      contentType: 'application/json',
      data: JSON.stringify({updates: saveData})
    }).done(() => {
      dispatch(finishSave(sectionId, stageId, newLockStatus));
      onComplete();
    })
    .fail(err => {
      console.error(err);
      onComplete();
    });
  };
};

export const saveLockDialog = (newLockStatus) => {
  return (dispatch, getState) => {
    const stageId = getState().stageLock.lockDialogStageId;
    dispatch(performSave(newLockStatus, stageId, () => {
      dispatch(closeLockDialog());
    }));
  };
};

export const lockStage = (sectionId, stageId) => {
  return (dispatch, getState) => {
    const state = getState();
    const section = state.stageLock.sections[sectionId];
    const oldLockStatus = lockStatusForStage(section, stageId);
    const newLockStatus = oldLockStatus.map(student => ({
      ...student,
      lockStatus: LockStatus.Locked
    }));
    dispatch(performSave(newLockStatus, stageId, () => {}));
  };
};

export const closeLockDialog = () => ({
  type: CLOSE_LOCK_DIALOG
});

// Helpers
const lockStatusForStage = (section, stageId) => {
  const students = section.stages[stageId];
  return students.map(student => ({
    userLevelData: student.user_level_data,
    name: student.name,
    lockStatus: student.locked ? LockStatus.Locked : (
      student.readonly_answers ? LockStatus.ReadonlyAnswers : LockStatus.Editable)
  }));
};

/**
 * Helper that returns a mapping of stageId to whether or not it is fully locked
 * in the current section. A stage is fully locked if and only if it is locked
 * for all of the students in the section
 */
export const fullyLockedStageMapping = (state) => {
  const { sections, selectedSection }  = state;

  if (!selectedSection) {
    return {};
  }

  const section = sections[selectedSection];
  const stageIds = Object.keys(section.stages);

  return stageIds.reduce((obj, stageId) => {
    const students = section.stages[stageId];
    const fullyLocked = !students.some(student => !student.locked);
    return {
      ...obj,
      [stageId]: fullyLocked
    };
  }, {});
};
