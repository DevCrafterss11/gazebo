import type { ExperimentResult } from '../types/result';
import type {
  ExamQuestion,
  ExamQuestionResult,
  ExperimentOneAssessment,
  ExamQuestionKind,
  PracticalAssessment,
  PracticalEvidenceEvent,
  ScoreBreakdown,
  SectionQuizAssessment,
  SectionQuizQuestionDefinition,
  SectionQuizQuestionResult,
} from '../types/experiment1Assessment';

export const EXPERIMENT1_EXAM_VERSION = 'experiment1-final-v1';
export const EXPERIMENT1_EXAM_DURATION_MS = 15 * 60 * 1000;
export const EXPERIMENT1_SECTION_QUIZ_MAX_SCORES = [3, 3] as const;

const fixedQuestions: ExamQuestion[] = [
  { id: 'final-q1', kind: 'single', prompt: '四旋翼主要通过什么方式产生升力？', options: [{ id: 'a', label: '四个旋翼共同产生向上的气动力' }, { id: 'b', label: '机身固定翼产生升力' }, { id: 'c', label: 'GPS 天线产生推力' }, { id: 'd', label: '改变机臂长度' }], correctAnswer: ['a'], points: 10, explanation: '旋翼推动空气向下，反作用力使飞行器获得升力。', knowledge: 'basics' },
  { id: 'final-q2', kind: 'single', prompt: 'IMU 在飞控中的主要作用是什么？', options: [{ id: 'a', label: '测量角速度与加速度' }, { id: 'b', label: '接收遥控器视频' }, { id: 'c', label: '测量电池容量' }, { id: 'd', label: '记录地图影像' }], correctAnswer: ['a'], points: 10, explanation: 'IMU 提供角速度和加速度观测，是姿态估计的重要来源。', knowledge: 'flight-control' },
  { id: 'final-q3', kind: 'single', prompt: '实验参数中的 RTL 高度应如何设置？', options: [{ id: 'a', label: '高于起飞高度且不超过最大高度' }, { id: 'b', label: '始终设置为 0' }, { id: 'c', label: '低于地面高度' }, { id: 'd', label: '与 GPS 卫星数相同' }], correctAnswer: ['a'], points: 10, explanation: '返航高度要有足够越障余量，并受最大高度约束。', knowledge: 'flight-control' },
  { id: 'final-q4', kind: 'single', prompt: '执行起飞操作前最重要的做法是什么？', options: [{ id: 'a', label: '完成飞控、定位、周边和起飞区检查' }, { id: 'b', label: '直接解锁以节省时间' }, { id: 'c', label: '关闭所有告警' }, { id: 'd', label: '只确认电机能转' }], correctAnswer: ['a'], points: 10, explanation: '起飞前须确认飞行器状态、定位、空域和人员安全。', knowledge: 'safety' },
  { id: 'final-q5', kind: 'multiple', prompt: '哪些项目属于起飞前安全检查？（多选）', options: [{ id: 'a', label: '确认螺旋桨安装和机体状态' }, { id: 'b', label: '确认 GPS/EKF 与通信状态' }, { id: 'c', label: '确认飞行区域及人员已避让' }, { id: 'd', label: '忽略低电量提示' }], correctAnswer: ['a', 'b', 'c'], points: 15, explanation: '机械状态、定位通信和环境安全都需确认；不得忽视低电量告警。', knowledge: 'safety' },
  { id: 'final-q6', kind: 'multiple', prompt: '哪些操作有助于安全完成基础飞行？（多选）', options: [{ id: 'a', label: '先小幅、平稳输入控制量' }, { id: 'b', label: '持续观察高度、速度与姿态' }, { id: 'c', label: '异常时按预案暂停、返航或降落' }, { id: 'd', label: '失去定位后继续自动航线' }], correctAnswer: ['a', 'b', 'c'], points: 15, explanation: '平稳操纵、观察遥测并按预案响应异常；定位异常时不能盲目续飞。', knowledge: 'flight-operation' },
  { id: 'final-q7', kind: 'judgment', prompt: '飞控心跳中断时，即使机体暂时稳定，也应先恢复通信并确认状态。', options: [{ id: 'true', label: '正确' }, { id: 'false', label: '错误' }], correctAnswer: ['true'], points: 5, explanation: '心跳中断意味着无法可靠确认飞控状态，应先排查链路。', knowledge: 'safety' },
  { id: 'final-q8', kind: 'judgment', prompt: 'GPS 定位异常时，依赖 GPS 的自动返航一定可以安全完成。', options: [{ id: 'true', label: '正确' }, { id: 'false', label: '错误' }], correctAnswer: ['false'], points: 5, explanation: 'GPS 异常会影响定位与返航判断，应按现场条件采取安全处置。', knowledge: 'exception' },
];

const scenarioQuestions: ExamQuestion[] = [
  { id: 'final-q9-gps', kind: 'scenario', scenarioKey: 'gps', prompt: '起飞后 GPS 状态突然恶化，位置漂移增大，但飞行器仍可控。你应如何处理？', options: [{ id: 'a', label: '继续执行航点，等待 GPS 自行恢复' }, { id: 'b', label: '停止扩展任务，保持可控并按预案转入安全降落/返航决策' }, { id: 'c', label: '立刻高速飞向远处开阔区' }, { id: 'd', label: '关闭飞控定位告警' }], correctAnswer: ['b'], points: 10, explanation: '先控制风险、停止扩大任务，并依据剩余定位能力和现场条件选择安全降落或返航。', knowledge: 'exception' },
  { id: 'final-q10-link', kind: 'scenario', scenarioKey: 'link', prompt: '飞行中遥控链路中断，机体正接近障碍物，现场观察员仍可看到无人机。最合理的处置是什么？', options: [{ id: 'a', label: '连续盲目发送摇杆指令' }, { id: 'b', label: '观察预设失联策略与飞行器状态，确保地面人员远离并准备接管/应急处置' }, { id: 'c', label: '跑到无人机下方接住它' }, { id: 'd', label: '立即关闭地面站' }], correctAnswer: ['b'], points: 10, explanation: '失联时应依照预先验证的失联策略和可观测状态处置，优先隔离地面人员风险。', knowledge: 'exception' },
  { id: 'final-q9-safety', kind: 'scenario', scenarioKey: 'generic-safety', prompt: '降落区域出现人员进入，飞行器仍处于悬停状态。你应如何处理？', options: [{ id: 'a', label: '继续降落，人员会自行避让' }, { id: 'b', label: '保持可控悬停或复飞，确认区域清空后再降落' }, { id: 'c', label: '关闭电机让飞行器自然下落' }, { id: 'd', label: '提高速度快速降落' }], correctAnswer: ['b'], points: 10, explanation: '人员进入降落区时应保持安全间隔，待区域清空并重新确认后再降落。', knowledge: 'safety' },
  { id: 'final-q10-safety', kind: 'scenario', scenarioKey: 'generic-safety', prompt: '返航过程中高度不足以越过前方障碍物，最安全的决策是什么？', options: [{ id: 'a', label: '继续保持当前高度返航' }, { id: 'b', label: '按预案调整到安全返航高度，或在安全区域降落' }, { id: 'c', label: '关闭高度限制' }, { id: 'd', label: '向障碍物方向加速' }], correctAnswer: ['b'], points: 10, explanation: '返航必须满足越障高度和场地安全条件，不能盲目保持不足高度。', knowledge: 'safety' },
];

export const experiment1ExamQuestions: ExamQuestion[] = [...fixedQuestions, scenarioQuestions[2]!, scenarioQuestions[3]!];

const cloneQuestion = (question: ExamQuestion, evidenceEventIds: string[] = []): ExamQuestion => ({
  ...question,
  options: question.options.map((option) => ({ ...option })),
  correctAnswer: [...question.correctAnswer],
  evidenceEventIds: evidenceEventIds.length > 0 ? [...evidenceEventIds] : undefined,
});

export const createFinalExamSnapshot = (evidenceEvents: PracticalEvidenceEvent[]): ExamQuestion[] => {
  const eventText = evidenceEvents.map((event) => event.message).join(' ').toLowerCase();
  const gpsEvidence = evidenceEvents.filter((event) => /gps|定位|卫星/.test(event.message.toLowerCase())).map((event) => event.id);
  const linkEvidence = evidenceEvents.filter((event) => /通信|心跳|链路|mavlink/.test(event.message.toLowerCase())).map((event) => event.id);
  const candidates: Array<{ question: ExamQuestion; matched: boolean; evidence: string[] }> = [
    { question: scenarioQuestions[0]!, matched: /gps|定位|卫星/.test(eventText), evidence: gpsEvidence },
    { question: scenarioQuestions[1]!, matched: /通信|心跳|链路|mavlink/.test(eventText), evidence: linkEvidence },
    { question: scenarioQuestions[2]!, matched: /降落|人员|安全/.test(eventText), evidence: [] },
    { question: scenarioQuestions[3]!, matched: /返航|障碍|高度/.test(eventText), evidence: [] },
  ];
  const selected: Array<{ question: ExamQuestion; evidence: string[] }> = [];
  for (const candidate of candidates) {
    if (candidate.matched && selected.length < 2 && !selected.some((item) => item.question.id === candidate.question.id)) selected.push(candidate);
  }
  for (const candidate of candidates.filter((item) => item.question.scenarioKey === 'generic-safety')) {
    if (selected.length >= 2) break;
    if (!selected.some((item) => item.question.id === candidate.question.id)) selected.push(candidate);
  }
  for (const candidate of candidates) {
    if (selected.length >= 2) break;
    if (!selected.some((item) => item.question.id === candidate.question.id)) selected.push(candidate);
  }
  return [...fixedQuestions.map((question) => cloneQuestion(question)), ...selected.map((item) => cloneQuestion(item.question, item.evidence))];
};

export const validateFinalExamSnapshot = (questions: ExamQuestion[]): string | null => {
  if (questions.length !== 10) return '理论试卷题目数量不足，无法开始正式考核。';
  if (questions.reduce((total, question) => total + question.points, 0) !== 100) return '理论试卷分值配置无效，无法开始正式考核。';
  const counts = new Map<ExamQuestionKind, number>();
  for (const question of questions) counts.set(question.kind, (counts.get(question.kind) ?? 0) + 1);
  if (counts.get('single') !== 4 || counts.get('multiple') !== 2 || counts.get('judgment') !== 2 || counts.get('scenario') !== 2) return '理论试卷题型配置无效，无法开始正式考核。';
  return null;
};

export const createInitialExperiment1Assessment = (sessionId: string): ExperimentOneAssessment => ({
  sessionId,
  scoringVersion: 'experiment1-v2',
  status: 'IN_PROGRESS',
  sectionQuizzes: [],
  practicalAssessment: null,
  exam: { status: 'NOT_STARTED', version: EXPERIMENT1_EXAM_VERSION, questionSnapshot: [], answers: {}, startedAt: null, deadline: null, submittedAt: null, rawScore: null, questionResults: [] },
  finalResult: null,
  finalizedAt: null,
  totalScore: null,
});

export const normalizeExperiment1Assessment = (assessment: ExperimentOneAssessment, sessionId: string): ExperimentOneAssessment => {
  const base = createInitialExperiment1Assessment(sessionId);
  const sectionQuizzes = (assessment.sectionQuizzes ?? []).map((quiz) => {
    const maxScore = typeof quiz.maxScore === 'number' && quiz.maxScore > 0 ? quiz.maxScore : quiz.questionCount;
    const rawScore = Math.max(0, Math.min(maxScore, quiz.rawScore ?? 0));
    return { ...quiz, maxScore, rawScore, normalizedScore: typeof quiz.normalizedScore === 'number' ? quiz.normalizedScore : maxScore > 0 ? rawScore / maxScore * 100 : 0, questionResults: Array.isArray(quiz.questionResults) ? quiz.questionResults : [] };
  });
  const exam = { ...base.exam, ...(assessment.exam ?? {}), questionSnapshot: assessment.exam?.questionSnapshot ?? [], answers: assessment.exam?.answers ?? {}, questionResults: assessment.exam?.questionResults ?? [] };
  const status = assessment.status ?? (assessment.finalizedAt ? 'GRADED' : exam.status === 'SUBMITTED' ? 'AWAITING_FINALIZATION' : exam.status === 'IN_PROGRESS' ? 'EXAM_IN_PROGRESS' : assessment.practicalResult ? 'AWAITING_EXAM' : 'IN_PROGRESS');
  return { ...base, ...assessment, sessionId, status, sectionQuizzes, exam, practicalAssessment: assessment.practicalAssessment ?? null };
};

export const buildPracticalAssessment = (result: ExperimentResult, timeline: PracticalEvidenceEvent[]): PracticalAssessment => {
  const evidence = timeline.map((event, index) => ({ ...event, id: event.id || `evidence-${index + 1}` }));
  const completionScore = Math.max(0, Math.min(60, result.completionRate * 0.6));
  const stabilityScore = Math.max(0, Math.min(20, 20 - result.averageAltitudeError * 8));
  const safetyScore = Math.max(0, Math.min(20, 20 - result.safetyEvents.length * 5));
  return {
    rawScore: Math.max(0, Math.min(100, result.score)), source: 'training-engine', recordedAt: result.completedAt, evidenceEvents: evidence,
    scoreItems: [
      { id: 'task-completion', label: '基础飞行任务完成', maxScore: 60, actualScore: completionScore, status: completionScore >= 60 ? 'COMPLETED' : completionScore > 0 ? 'PARTIAL' : 'NOT_COMPLETED', deductionReason: completionScore >= 60 ? '全部训练任务完成。' : `完成率 ${result.completionRate}%，未完成任务影响该项得分。`, evidenceEventIds: evidence.filter((event) => event.type === 'TASK_COMPLETED').map((event) => event.id), improvement: '按任务顺序完成解锁、起飞、悬停、机动、返航和降落。' },
      { id: 'flight-stability', label: '飞行稳定性与控制', maxScore: 20, actualScore: stabilityScore, status: stabilityScore >= 20 ? 'COMPLETED' : stabilityScore > 0 ? 'PARTIAL' : 'NOT_COMPLETED', deductionReason: result.averageAltitudeError <= 0 ? '未记录有效高度误差。' : `平均高度误差 ${result.averageAltitudeError.toFixed(2)}m。`, evidenceEventIds: evidence.filter((event) => event.type === 'TRAINING').map((event) => event.id), improvement: '加强悬停时的高度保持，持续观察遥测反馈。' },
      { id: 'safety-operations', label: '安全操作与异常处置', maxScore: 20, actualScore: safetyScore, status: safetyScore >= 20 ? 'COMPLETED' : safetyScore > 0 ? 'PARTIAL' : 'NOT_COMPLETED', deductionReason: result.safetyEvents.length === 0 ? '未记录安全事件。' : `记录 ${result.safetyEvents.length} 条安全事件。`, evidenceEventIds: evidence.filter((event) => event.type === 'SAFETY').map((event) => event.id), improvement: result.safetyEvents.length > 0 ? '结合安全事件复盘检查顺序和异常处置预案。' : '继续保持起飞前检查、返航和安全降落规范。' },
    ],
  };
};

export const gradeSectionQuiz = (definitions: SectionQuizQuestionDefinition[], answers: Record<string, string>): { questionResults: SectionQuizQuestionResult[]; correctCount: number; rawScore: number; maxScore: number; normalizedScore: number } => {
  const questionResults = definitions.map((definition) => ({ questionId: definition.id, answer: answers[definition.id] ?? '', correctAnswer: definition.correctAnswer, earned: answers[definition.id] === definition.correctAnswer ? 1 : 0, maxScore: 1, explanation: definition.explanation }));
  const rawScore = questionResults.reduce((total, question) => total + question.earned, 0);
  const maxScore = questionResults.reduce((total, question) => total + question.maxScore, 0);
  return { questionResults, correctCount: rawScore, rawScore, maxScore, normalizedScore: maxScore > 0 ? rawScore / maxScore * 100 : 0 };
};

export const scoreSectionQuiz = (input: Omit<SectionQuizAssessment, 'status' | 'questionResults' | 'correctCount' | 'questionCount' | 'rawScore' | 'maxScore' | 'normalizedScore' | 'submittedAt'>, correctCount: number, questionCount: number, submittedAt = new Date().toISOString()): SectionQuizAssessment => {
  const maxScore = Math.max(0, questionCount);
  const rawScore = Math.max(0, Math.min(maxScore, correctCount));
  return { ...input, status: 'SUBMITTED', questionResults: [], correctCount: rawScore, questionCount, rawScore, maxScore, normalizedScore: maxScore > 0 ? rawScore / maxScore * 100 : 0, submittedAt };
};

export const gradeFinalExam = (questions: ExamQuestion[], answers: Record<string, string[]>): { score: number; results: ExamQuestionResult[] } => {
  const results = questions.map((question) => {
    const answer = [...new Set(answers[question.id] ?? [])].sort();
    const correct = [...question.correctAnswer].sort();
    const earned = answer.length === correct.length && answer.every((value, index) => value === correct[index]) ? question.points : 0;
    return { ...question, answer, earned };
  });
  return { score: results.reduce((total, question) => total + question.earned, 0), results };
};

export const calculateExperiment1Score = (practicalRaw: number, sectionQuizzes: SectionQuizAssessment[], examRaw: number | null, requiredQuizMaxScores: readonly number[] = EXPERIMENT1_SECTION_QUIZ_MAX_SCORES): ScoreBreakdown => {
  const practical = Math.max(0, Math.min(100, practicalRaw));
  const requiredMax = requiredQuizMaxScores.reduce((total, maxScore) => total + Math.max(0, maxScore), 0);
  const sectionEarned = sectionQuizzes.reduce((total, quiz) => total + Math.max(0, Math.min(quiz.maxScore, quiz.rawScore)), 0);
  const sectionQuizRaw = requiredMax > 0 ? Math.max(0, Math.min(100, sectionEarned / requiredMax * 100)) : null;
  if (sectionQuizRaw === null || examRaw === null) return { practicalRaw: practical, practicalWeighted: practical * 0.7, sectionQuizRaw, sectionQuizWeighted: sectionQuizRaw === null ? null : sectionQuizRaw * 0.1, examRaw, examWeighted: examRaw === null ? null : examRaw * 0.2, total: null };
  const normalizedExam = Math.max(0, Math.min(100, examRaw));
  const total = Math.round((practical * 0.7 + sectionQuizRaw * 0.1 + normalizedExam * 0.2) * 10) / 10;
  return { practicalRaw: practical, practicalWeighted: practical * 0.7, sectionQuizRaw, sectionQuizWeighted: sectionQuizRaw * 0.1, examRaw: normalizedExam, examWeighted: normalizedExam * 0.2, total };
};
