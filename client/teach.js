// TODO(skishore): Do some kind of smoothing to avoid giving users hints based
// off of the straight segments where strokes intersects.
import {recognize} from '../lib/recognizer';
import {Timing} from '../model/timing';
import {findCorners} from './corners';
import {Shortstraw} from './external/shortstraw';
import {Handwriting} from './handwriting';
import {lookupItem} from './lookup';

const definition = new ReactiveVar();
const pinyin = new ReactiveVar();

let handwriting = null;

const kMaxMistakes = 3;
const kMaxPenalties  = 4;

const item = {card: null, mistakes: 0, penalties: 0, result: null, steps: []};

// A couple small utility functions for Euclidean geometry.

const fixMedianCoordinates = (median) => median.map((x) => [x[0], 900 - x[1]]);

const getResult = (x) => Math.min(Math.floor(2 * x / kMaxPenalties) + 1, 3);

const match = (stroke, expected) => {
  let best_result = {index: -1, score: -Infinity};
  for (let i = 0; i < item.steps.length; i++) {
    const median = item.steps[i].median;
    const offset = i - expected;
    const result = recognize(stroke, median, offset);
    if (result.score > best_result.score) {
      best_result = result;
      best_result.index = i;
    }
  }
  return best_result;
}

const maybeAdvance = () => {
  const missing = _.range(item.steps.length)
                   .filter((i) => !item.steps[i].done);
  if (missing.length === 0) {
    handwriting.clear();
    Timing.completeCard(item.card, item.result);
    return true;
  }
  return false;
}

// Event handlers which will be bound to various Meteor-dispatched events.

const onClick = () => {
  if (maybeAdvance()) return;
  const missing = _.range(item.steps.length)
                   .filter((i) => !item.steps[i].done);
  item.penalties += kMaxPenalties;
  handwriting.flash(item.steps[missing[0]].stroke);
}

const onDouble = () => {
  if (maybeAdvance()) return;
  const missing = _.range(item.steps.length)
                   .filter((i) => !item.steps[i].done);
  handwriting.reveal(item.steps.map((x) => x.stroke));
  handwriting.highlight(item.steps[missing[0]].stroke);
}

const onRendered = function() {
  const element = $(this.firstNode).find('.handwriting');
  const options = {onclick: onClick, ondouble: onDouble, onstroke: onStroke};
  handwriting = new Handwriting(element, options);
}

const onStroke = (stroke) => {
  if (maybeAdvance()) return;
  const missing = _.range(item.steps.length)
                   .filter((i) => !item.steps[i].done);
  const result = match((new Shortstraw).run(stroke), missing[0]);
  const index = result.index;

  // The user's input does not match any of the character's strokes.
  if (index < 0) {
    item.mistakes += 1;
    handwriting.fade();
    if (item.mistakes >= kMaxMistakes) {
      item.penalties += kMaxPenalties;
      handwriting.flash(item.steps[missing[0]].stroke);
    }
    return;
  }

  // The user's input matches a stroke that was already drawn.
  if (item.steps[index].done) {
    item.penalties += 1;
    handwriting.undo();
    handwriting.flash(item.steps[index].stroke);
    return;
  }

  // The user's input matches one of the remaining strokes.
  item.steps[index].done = true;
  const rotate = item.steps[index].median.length === 2;
  handwriting.emplace([item.steps[index].stroke, rotate,
                       result.source, result.target]);
  if (result.warning) {
    // TODO(skishore): Maybe penalize on certain warnings.
    handwriting.warn(result.warning);
  }
  if (missing.length === 1) {
    item.result = getResult(item.penalties);
    handwriting.glow(item.result);
    handwriting.highlight();
  } else if (missing[0] < index) {
    item.penalties += 2 * (index - missing[0]);
    handwriting.flash(item.steps[missing[0]].stroke);
  } else {
    item.mistakes = 0;
    handwriting.highlight(item.steps[missing[1]].stroke);
  }
}

const updateCharacter = () => {
  // TODO(skishore): Handle error cards and non-writing cards.
  // TODO(skishore): Allow the user to correct our grading of them.
  const card = Timing.getNextCard();
  lookupItem((card && card.data), (data, error) => {
    if (error) {
      console.error(error);
      Meteor.setTimeout(Timing.shuffle);
      return;
    }
    const card = Timing.getNextCard();
    const row = data.characters[0];
    if (card && data.word === card.data.word) {
      definition.set(data.definition);
      pinyin.set(data.pinyin);
      handwriting && handwriting.clear();
      item.card = card;
      item.mistakes = 0;
      item.penalties = 0;
      item.result = null;
      item.steps = _.range(row.strokes.length).map((i) => ({
        done: false,
        median: findCorners([row.medians[i]])[0],
        stroke: row.strokes[i],
      }));
    }
  });
}

// Meteor template bindings.

Template.teach.helpers({
  definition: () => definition.get(),
  pinyin: () => pinyin.get(),
});

Template.teach.onRendered(onRendered);

Meteor.startup(() => Deps.autorun(updateCharacter));
