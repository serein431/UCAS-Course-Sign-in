import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCourseSchedule, findCourseByKey } from '../src/lib/course-policy.mjs';

const base = {
 id: '1234567', uuid: 'A'.repeat(32), courseName: '操作系统',
 teacherName: '模拟教师', classroomName: '测试教室一',
 classBeginTime: '2026-10-15 08:30:00', classEndTime: '2026-10-15 10:10:00',
 signStatus: '0',
};

test('三条同名同UUID记录使用各自的课次ID，选择后两条不会取到第一条', () => {
 const { courses, total, sameNameGroups } = normalizeCourseSchedule([
  base, { ...base, id: '1234568' }, { ...base, id: '1234569' },
 ], '20261015');
 assert.equal(total, 3);
 assert.equal(sameNameGroups, 1);
 assert.equal(new Set(courses.map(course => course.key)).size, 3);
 assert.deepEqual(courses.map(course => course.sameNameIndex), [1, 2, 3]);
 for (const course of courses) {
  assert.equal(course.sameNameCount, 3);
  assert.equal(course.canGenerate, true);
  assert.equal(findCourseByKey(courses, course.key).id, course.id);
 }
 assert.equal(findCourseByKey(courses, courses[1].key).id, '1234568');
 assert.equal(findCourseByKey(courses, courses[2].key).id, '1234569');
 assert.equal(findCourseByKey(courses, ''), null);
 assert.equal(findCourseByKey(courses, 'missing'), null);
});

test('同名但教室、时段或班级不同的记录保留', () => {
 const { courses } = normalizeCourseSchedule([
  base, { ...base, classroomName: '测试教室二' },
  { ...base, classBeginTime: '2026-10-15 10:30:00' },
  { ...base, className: '模拟班级二' },
 ], '20261015');
 assert.equal(courses.length, 4);
 assert.equal(new Set(courses.map(course => course.key)).size, 4);
});

test('仅整个JSON完全重复时合并，字段顺序不影响判断', () => {
 const reversed = Object.fromEntries(Object.entries(base).reverse());
 const data = normalizeCourseSchedule([base, reversed, { ...base, id: '1234568' }], '20261015');
 assert.equal(data.upstreamTotal, 3);
 assert.equal(data.total, 2);
 assert.equal(data.duplicateCount, 1);
});

test('未知字段不同不默默合并，无法区分的记录禁止选择且不返回未知字段', () => {
 const { courses, duplicateCount } = normalizeCourseSchedule([
  { ...base, privateField: 'private-a' }, { ...base, privateField: 'private-b' },
 ], '20261015');
 assert.equal(courses.length, 2);
 assert.equal(duplicateCount, 0);
 assert.notEqual(courses[0].key, courses[1].key);
 for (const course of courses) {
  assert.equal(course.ambiguousIdentity, true);
  assert.equal(course.canGenerate, false);
  assert.match(course.selectionIssue, /无法确认课次/);
 }
 assert.equal(JSON.stringify(courses).includes('private-'), false);
});

test('签到状态更新不改变课次key', () => {
 const first = normalizeCourseSchedule([base], '20261015').courses[0];
 const refreshed = normalizeCourseSchedule([{ ...base, signStatus: '1' }], '20261015').courses[0];
 assert.equal(first.key, refreshed.key);
 assert.equal(refreshed.signStatus, '1');
});

test('数字ID转字符串，courseId不能冒充课次ID', () => {
 const result = normalizeCourseSchedule([
  { ...base, id: 1234567 },
  { courseId: 1234568, uuid: base.uuid, courseName: '其他课程' },
 ], '20261015');
 assert.equal(result.courses.find(course => course.id === '1234567').canGenerate, true);
 const missing = result.courses.find(course => course.courseId === '1234568');
 assert.equal(missing.id, '');
 assert.equal(missing.canGenerate, false);
 assert.match(missing.selectionIssue, /7位课次ID/);
});

test('学校返回不同日期时保留记录但阻止使用；未返回日期则标注查询日期来源', () => {
 const wrong = normalizeCourseSchedule([{ ...base, classBeginTime: '2026-10-16 08:30:00' }], '2026-10-15').courses[0];
 assert.equal(wrong.date, '2026-10-16');
 assert.equal(wrong.dateSource, 'upstream');
 assert.equal(wrong.canGenerate, false);
 assert.match(wrong.selectionIssue, /日期不一致/);
 const inferred = normalizeCourseSchedule([{ ...base, classBeginTime: '08:30', classEndTime: '10:10' }], '2026-10-15').courses[0];
 assert.equal(inferred.date, '2026-10-15');
 assert.equal(inferred.dateSource, 'query');
});

test('不接受异常课表格式', () => {
 for (const input of [null, {}, [null], ['record']]) {
  assert.throws(() => normalizeCourseSchedule(input, '20261015'));
 }
 assert.throws(() => normalizeCourseSchedule([], '20260230'));
});
