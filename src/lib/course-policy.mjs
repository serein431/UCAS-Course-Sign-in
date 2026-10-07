import { normalizeCourseDate, normalizeCourseSchedId } from './sign-policy.mjs';

const text = (value) => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
function firstText(item, fields) {
 for (const field of fields) { const value = text(item[field]); if (value) return value; }
 return '';
}
function canonical(value) {
 if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
 if (value && typeof value === 'object') {
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
 }
 return JSON.stringify(value);
}
function dateFromTime(value, queryDate) {
 const prefix = value.match(/^(\d{4}-\d{2}-\d{2})[ T]/)?.[1];
 const compact = prefix ? normalizeCourseDate(prefix) : null;
 const result = compact ?? queryDate;
 return { date: `${result.slice(0, 4)}-${result.slice(4, 6)}-${result.slice(6, 8)}`, dateSource: compact ? 'upstream' : 'query' };
}

export function normalizeCourseSchedule(items, queryDate) {
 queryDate = normalizeCourseDate(queryDate);
 if (!Array.isArray(items) || !queryDate) throw new Error('课表响应格式错误');
 const seen = new Set();
 const records = [];
 let duplicateCount = 0;
 for (const raw of items) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('课表记录格式错误');
  // 只合并整个原始JSON记录完全相同的情况，不按名称、UUID或截取后的字段去重。
  const signature = canonical(raw);
  if (seen.has(signature)) { duplicateCount++; continue; }
  seen.add(signature);
  const begin = firstText(raw, ['classBeginTime']);
  const end = firstText(raw, ['classEndTime']);
  const record = {
   id: firstText(raw, ['id', 'courseSchedId']),
   uuid: firstText(raw, ['uuid', 'timeTableId']),
   courseId: firstText(raw, ['courseId']),
   courseCode: firstText(raw, ['courseCode', 'courseNo']),
   courseName: firstText(raw, ['courseName']),
   teacherName: firstText(raw, ['teacherName']),
   classroomName: firstText(raw, ['classroomName', 'classRoomName', 'roomName', 'classroom']),
   className: firstText(raw, ['className', 'teachingClassName']),
   weekDay: firstText(raw, ['weekDay']),
   classBeginTime: begin,
   classEndTime: end,
   signStatus: firstText(raw, ['signStatus']),
   ...dateFromTime(begin, queryDate),
  };
  // UUID可能在多个课次间复用。状态不参与身份计算，签到后刷新仍能找到原课次。
  record.identity = JSON.stringify([
   record.id, record.uuid, record.courseId, record.courseCode, record.date,
   begin, end, record.courseName, record.teacherName, record.classroomName, record.className,
  ]);
  records.push(record);
 }
 records.sort((a, b) => a.date.localeCompare(b.date) || a.classBeginTime.localeCompare(b.classBeginTime) || a.id.localeCompare(b.id, 'en', { numeric: true }));
 const identities = new Map();
 const names = new Map();
 for (const record of records) {
  identities.set(record.identity, (identities.get(record.identity) ?? 0) + 1);
  if (record.courseName) names.set(record.courseName, (names.get(record.courseName) ?? 0) + 1);
 }
 const occurrences = new Map();
 const nameOccurrences = new Map();
 const courses = records.map(({ identity, ...record }) => {
  const occurrence = (occurrences.get(identity) ?? 0) + 1;
  occurrences.set(identity, occurrence);
  const sameNameIndex = (nameOccurrences.get(record.courseName) ?? 0) + 1;
  nameOccurrences.set(record.courseName, sameNameIndex);
  const ambiguousIdentity = identities.get(identity) > 1;
  let selectionIssue = '';
  if (ambiguousIdentity) selectionIssue = '学校返回了相同编号但内容不一致的记录，无法确认课次，请核对官方课表';
  else if (!normalizeCourseSchedId(record.id)) selectionIssue = '学校未提供有效的7位课次ID，不能确认签到目标';
  else if (record.date.replaceAll('-', '') !== queryDate) selectionIssue = '学校返回的上课日期与查询日期不一致，请核对日期后重新查询';
  return {
   ...record,
   key: `${identity}#${occurrence}`,
   sameNameCount: names.get(record.courseName) ?? 1,
   sameNameIndex,
   ambiguousIdentity,
   canGenerate: !selectionIssue,
   selectionIssue,
  };
 });
 return {
  courses, total: courses.length, upstreamTotal: items.length, duplicateCount,
  sameNameGroups: [...names.values()].filter(count => count > 1).length,
 };
}

export function findCourseByKey(courses, key) {
 if (!key) return null;
 return courses.find(course => course.key === key) ?? null;
}
