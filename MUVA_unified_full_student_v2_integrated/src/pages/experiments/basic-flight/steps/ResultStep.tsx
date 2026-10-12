import { CheckCircle2, ChevronLeft, ChevronRight, Clock3, FileDown, RotateCcw, ShieldCheck, Trophy } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { calculateExperiment1Score } from '../../../../domain/experiment1Assessment';
import type { ExamQuestion } from '../../../../types/experiment1Assessment';
import { ConfirmDialog } from '../../../../components/common/ConfirmDialog/ConfirmDialog';
import { PanelShell } from '../../../../components/common/PanelShell/PanelShell';
import { useExperimentStore } from '../../../../stores/experimentStore';
import { usePlatformUiStore } from '../../../../stores/platformUiStore';
import styles from '../components/WorkflowSteps.module.css';

const quizDefinitions = [
  { quizId: 'system-cognition' as const, title: '系统组成认知自测', step: 1, maxScore: 3 },
  { quizId: 'flight-diagnostics' as const, title: '飞控诊断自测', step: 5, maxScore: 3 },
];

const examTypeLabel = (kind: ExamQuestion['kind']): string => ({ single: '单选题', multiple: '多选题', judgment: '判断题', scenario: '场景题' })[kind];
const knowledgeLabel = (knowledge: ExamQuestion['knowledge']): string => ({ basics: '无人机基础认知', 'flight-control': '参数与飞控理解', safety: '飞行安全意识', 'flight-operation': '基础飞行操作', exception: '异常处理能力' })[knowledge];
const answerLabels = (question: ExamQuestion, answer: string[]): string => answer.length > 0
  ? answer.map((id) => question.options.find((option) => option.id === id)?.label ?? id).join('；')
  : '未作答';

export function ResultStep() {
  const result = useExperimentStore((state) => state.result);
  const sessionId = useExperimentStore((state) => state.sessionId);
  const assessment = useExperimentStore((state) => state.assessment);
  const assessmentError = useExperimentStore((state) => state.assessmentError);
  const startFinalExam = useExperimentStore((state) => state.startFinalExam);
  const saveFinalExamAnswer = useExperimentStore((state) => state.saveFinalExamAnswer);
  const submitFinalExam = useExperimentStore((state) => state.submitFinalExam);
  const retryAssessmentSave = useExperimentStore((state) => state.retryAssessmentSave);
  const finalizeExperimentAssessment = useExperimentStore((state) => state.finalizeExperimentAssessment);
  const restartExperiment = useExperimentStore((state) => state.restartExperiment);
  const showToast = usePlatformUiStore((state) => state.showToast);
  const navigate = useNavigate();
  const [confirmingRestart, setConfirmingRestart] = useState(false);
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);
  const [activeTab, setActiveTab] = useState<'exam' | 'report'>('exam');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [remainingMs, setRemainingMs] = useState(0);

  const exam = assessment?.exam;
  const questions = exam?.questionSnapshot ?? [];
  const currentQuestion = questions[questionIndex] ?? null;
  const answeredCount = questions.filter((question) => (exam?.answers[question.id] ?? []).length > 0).length;
  const practicalRaw = assessment?.practicalAssessment?.rawScore ?? assessment?.practicalResult?.score ?? result?.score ?? 0;
  const scoreBreakdown = useMemo(() => assessment?.finalResult ?? (result && assessment ? calculateExperiment1Score(practicalRaw, assessment.sectionQuizzes, exam?.rawScore ?? null) : null), [assessment, exam?.rawScore, practicalRaw, result]);
  const examStats = useMemo(() => {
    if (!exam || exam.status !== 'SUBMITTED') return null;
    return (['single', 'multiple', 'judgment', 'scenario'] as const).map((kind) => {
      const items = exam.questionResults.filter((question) => question.kind === kind);
      return { kind, earned: items.reduce((total, item) => total + item.earned, 0), max: items.reduce((total, item) => total + item.points, 0), correct: items.filter((item) => item.earned > 0).length, count: items.length };
    });
  }, [exam]);

  useEffect(() => {
    if (!exam || exam.status !== 'IN_PROGRESS' || !exam.deadline) return undefined;
    const update = () => {
      const next = Math.max(0, new Date(exam.deadline as string).getTime() - Date.now());
      setRemainingMs(next);
      if (next === 0) void submitFinalExam();
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [exam, submitFinalExam]);

  useEffect(() => {
    if (questionIndex >= questions.length && questions.length > 0) setQuestionIndex(questions.length - 1);
  }, [questionIndex, questions.length]);

  if (!result) {
    return <div className={styles.resultPage}><PanelShell title="实验结果" icon={Trophy}><div className={styles.resultContent}><h2>尚未生成实验结果</h2><p>完成基础飞行训练后，评分、遥测与报告会显示在这里。</p><div className={styles.resultActions}><button type="button" onClick={() => setConfirmingRestart(true)}>重新开始实验一</button><button type="button" onClick={() => navigate('/experiments')}>返回实验中心</button></div></div>{confirmingRestart ? <ConfirmDialog title="重新开始实验一" description="当前实验配置、检查进度和飞行数据将被重置。" onCancel={() => setConfirmingRestart(false)} onConfirm={async () => { setConfirmingRestart(false); await restartExperiment(); }} confirmLabel="确认重置" /> : null}</PanelShell></div>;
  }

  const formatRemaining = (milliseconds: number): string => {
    const seconds = Math.ceil(milliseconds / 1000);
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  };
  const updateAnswer = (question: ExamQuestion, optionId: string) => {
    if (!exam || exam.status !== 'IN_PROGRESS') return;
    const current = exam.answers[question.id] ?? [];
    const next = question.kind === 'multiple' ? current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId] : [optionId];
    void saveFinalExamAnswer(question.id, next);
  };

  return <div className={styles.resultPage}>
    <PanelShell title="实验结果" icon={Trophy} action={<span>训练报告</span>}>
      <div className={styles.resultWorkspace}>
        <div className={styles.resultTabs} role="tablist" aria-label="实验结果内容"><button type="button" role="tab" aria-selected={activeTab === 'exam'} className={activeTab === 'exam' ? styles.resultTabActive : ''} onClick={() => setActiveTab('exam')}><ShieldCheck size={16} />理论知识考核</button><button type="button" role="tab" aria-selected={activeTab === 'report'} className={activeTab === 'report' ? styles.resultTabActive : ''} onClick={() => setActiveTab('report')}><Trophy size={16} />成绩与实验复盘</button></div>
        {activeTab === 'exam' ? <section className={styles.examPanel} aria-label="最终理论考核">
          <div className={styles.examHeader}><div><h2>最终理论考核</h2><p>10 道题 · 15 分钟 · 满分 100 分 · 多选题完全匹配得分</p></div><div className={styles.examStatus}>{exam?.status === 'IN_PROGRESS' ? <><Clock3 size={16} />{formatRemaining(remainingMs)}</> : exam?.status === 'SUBMITTED' ? <><CheckCircle2 size={16} />已交卷</> : '未开始'}</div></div>
          {!exam || exam.status === 'NOT_STARTED' ? <div className={styles.examStart}><div className={styles.preExamScores}><div className={styles.resultScore}><strong>{practicalRaw.toFixed(1)}</strong><span>/ 100 实操原始分</span></div><div className={styles.resultScore}><strong>{scoreBreakdown?.sectionQuizRaw?.toFixed(1) ?? '--'}</strong><span>/ 100 小节测验原始分</span></div></div><p>实操训练和小节测验成绩已保存；完成考试后才会生成正式综合成绩。</p><button type="button" onClick={() => void startFinalExam()} disabled={!sessionId}>开始理论考核</button></div> : null}
          {exam && exam.status !== 'NOT_STARTED' && currentQuestion ? <><div className={styles.examProgress}><span>答题进度 {answeredCount} / {questions.length}</span><div><i style={{ width: `${questions.length ? answeredCount / questions.length * 100 : 0}%` }} /></div><span>第 {questionIndex + 1} / {questions.length} 题</span></div><div className={styles.questionNav}>{questions.map((question, index) => <button type="button" key={question.id} className={(exam.answers[question.id] ?? []).length > 0 ? styles.questionAnswered : ''} aria-label={`第 ${index + 1} 题`} onClick={() => setQuestionIndex(index)}>{index + 1}</button>)}</div><article className={styles.examQuestion}><div className={styles.questionTitle}><span>{examTypeLabel(currentQuestion.kind)} · {currentQuestion.points} 分</span>{exam.status === 'SUBMITTED' ? <b>{exam.questionResults.find((item) => item.id === currentQuestion.id)?.earned ?? 0} 分</b> : null}</div><h3>{currentQuestion.prompt}</h3><div className={styles.examOptions}>{currentQuestion.options.map((option) => { const selected = (exam.answers[currentQuestion.id] ?? []).includes(option.id); return <label className={selected ? styles.examOptionSelected : ''} key={option.id}><input type={currentQuestion.kind === 'multiple' ? 'checkbox' : 'radio'} name={currentQuestion.id} disabled={exam.status === 'SUBMITTED'} checked={selected} onChange={() => updateAnswer(currentQuestion, option.id)} />{option.label}</label>; })}</div>{exam.status === 'SUBMITTED' ? <div className={styles.answerReview}><strong>{exam.questionResults.find((item) => item.id === currentQuestion.id)?.earned ? '回答正确' : '需要复习'}</strong><span>正确答案：{currentQuestion.correctAnswer.join('、')}</span><p>{currentQuestion.explanation}</p></div> : null}</article><div className={styles.examActions}><button type="button" onClick={() => setQuestionIndex((index) => Math.max(0, index - 1))} disabled={questionIndex === 0}><ChevronLeft size={16} />上一题</button><button type="button" onClick={() => setQuestionIndex((index) => Math.min(questions.length - 1, index + 1))} disabled={questionIndex === questions.length - 1}>下一题<ChevronRight size={16} /></button>{exam.status === 'IN_PROGRESS' ? <button className={styles.submitExamButton} type="button" onClick={() => setConfirmingSubmit(true)}>正式交卷</button> : null}</div>{exam.status === 'IN_PROGRESS' ? <p className={styles.examHint}>提交前将自动统计未作答题目，未作答按 0 分计。</p> : null}</> : null}
          {exam?.status === 'SUBMITTED' ? <div className={styles.examSummary}><strong>理论考核成绩：{exam.rawScore ?? 0} / 100</strong><span>共 {questions.length} 题，已交卷后不可修改；可通过题号查看解析。</span><button type="button" onClick={() => setActiveTab('report')}>查看综合报告</button></div> : null}
          {assessmentError ? <p className={styles.assessmentError} role="alert">{assessmentError}<button type="button" onClick={() => void retryAssessmentSave()}>重试保存评分数据</button></p> : null}
        </section> : <section className={styles.reportPanel} aria-label="成绩与实验复盘">
          <div className={styles.resultScore}><strong>{scoreBreakdown?.total?.toFixed(1) ?? '--'}</strong><span>/ 100 {scoreBreakdown?.total === null ? '进行中' : '正式成绩'}</span></div><h2>{scoreBreakdown?.total === null ? '完成理论考核后正式结算' : '基础飞行训练已完成'}</h2>
          <div className={styles.weightedGrid}><div><span>实操成绩 · 70%</span><strong>{practicalRaw.toFixed(1)} <small>/ 100</small></strong><em>{(practicalRaw * 0.7).toFixed(1)} / 70</em></div><div><span>小节测验 · 10%</span><strong>{scoreBreakdown?.sectionQuizRaw?.toFixed(1) ?? '--'} <small>/ 100</small></strong><em>{scoreBreakdown?.sectionQuizWeighted?.toFixed(1) ?? '--'} / 10</em></div><div><span>最终理论 · 20%</span><strong>{scoreBreakdown?.examRaw?.toFixed(1) ?? '--'} <small>/ 100</small></strong><em>{scoreBreakdown?.examWeighted?.toFixed(1) ?? '--'} / 20</em></div></div>
          <div className={styles.practicalBreakdown}><h3>实操评分明细 · 来源：TrainingEngine 遥测与操作事件</h3>{assessment?.practicalAssessment?.scoreItems.map((item) => <div className={styles.assessmentRow} key={item.id}><span>{item.label}<small>{item.deductionReason}</small><small>关联记录：{item.evidenceEventIds.length > 0 ? item.evidenceEventIds.map((id) => assessment.practicalAssessment?.evidenceEvents.find((event) => event.id === id)?.message ?? id).join('；') : '遥测汇总或完成条件'}</small></span><strong>{item.actualScore.toFixed(1)} / {item.maxScore}<em>{item.status === 'COMPLETED' ? '已完成' : item.status === 'PARTIAL' ? '部分完成' : '未完成'}</em></strong><p>改进建议：{item.improvement}</p></div>) ?? <p>实操评分证据尚未保存。</p>}</div>
          <div className={styles.resultMetrics}><span>无人机<strong>{result.droneName}</strong></span><span>场景<strong>{result.sceneName}</strong></span><span>实验时间<strong>{result.durationSeconds}s</strong></span><span>完成任务<strong>{result.completedTasks}/10</strong></span><span>最大高度<strong>{result.maxAltitude.toFixed(1)}m</strong></span><span>最大速度<strong>{result.maxSpeed.toFixed(1)}m/s</strong></span><span>悬停误差<strong>{result.averageAltitudeError.toFixed(2)}m</strong></span><span>安全事件<strong>{result.safetyEvents.length}</strong></span></div>
          <div className={styles.reportSections}><div><h3>小节测验汇总</h3>{quizDefinitions.map((definition) => { const quiz = assessment?.sectionQuizzes.find((item) => item.quizId === definition.quizId); return <div className={styles.quizDetail} key={definition.quizId}><p><span>步骤{definition.step} · {definition.title}</span><strong>{quiz ? `${quiz.normalizedScore.toFixed(1)} / 100` : '0 / 100 · 未完成'}</strong></p>{quiz ? <details><summary>查看逐题结果 · 答对 {quiz.correctCount}/{quiz.questionCount}</summary>{quiz.questionResults.map((question) => <p key={question.questionId}><span>{question.questionId} · {question.answer || '未作答'}</span><strong>{question.earned ? '正确' : `错误 · 正确答案 ${question.correctAnswer}`} · {question.explanation}</strong></p>)}</details> : null}</div>; })}</div><div><h3>最终理论考核明细</h3>{examStats ? <><p>正确率：{examStats.reduce((total, item) => total + item.correct, 0)} / {questions.length}</p>{examStats.map((item) => <p key={item.kind}><span>{examTypeLabel(item.kind)}</span><strong>{item.earned} / {item.max} · {item.correct}/{item.count} 题</strong></p>)}<details><summary>查看完整答题记录</summary>{exam?.questionResults.map((question) => <p key={question.id}><span>{question.id} · {examTypeLabel(question.kind)} · 学生答案：{answerLabels(question, question.answer)}</span><strong>{question.earned > 0 ? '正确' : `错误 · 正确答案：${answerLabels(question, question.correctAnswer)}`} · {question.explanation}</strong></p>)}</details></> : <p>交卷后显示试卷分类成绩、正确率和错题解析。</p>}</div><div><h3>综合能力分析与复盘建议</h3>{exam?.status === 'SUBMITTED' ? (['basics', 'flight-control', 'safety', 'flight-operation', 'exception'] as const).map((knowledge) => { const items = exam.questionResults.filter((question) => question.knowledge === knowledge); const earned = items.reduce((total, item) => total + item.earned, 0); const max = items.reduce((total, item) => total + item.points, 0); return <p key={knowledge}><span>{knowledgeLabel(knowledge)}</span><strong>{max > 0 ? `${earned} / ${max}` : '暂无评价'}</strong></p>; }) : <p>理论考核完成后生成基于答题标签的能力分析。</p>}<p>建议：{result.averageAltitudeError > 1 ? '加强悬停高度控制；' : '保持稳定的高度控制；'}{result.safetyEvents.length > 0 ? '结合安全事件复习异常处置；' : '继续保持规范的安全检查；'}{exam?.questionResults.some((question) => question.knowledge === 'exception' && question.earned === 0) ? '重点复习 GPS 与通信异常下的安全决策。' : '继续巩固飞控、传感器和返航逻辑。'}</p></div></div>
          <div className={styles.resultActions}><button type="button" onClick={() => setConfirmingRestart(true)}><RotateCcw size={17} />重新实验</button><button type="button" onClick={() => { showToast('正在打开浏览器打印，可选择“另存为 PDF”。', 'success'); window.print(); }}><FileDown size={17} />导出报告</button>{assessment?.exam.status === 'SUBMITTED' && !assessment.finalizedAt && assessment.status !== 'ERROR' ? <button type="button" onClick={() => void finalizeExperimentAssessment()} disabled={!scoreBreakdown || scoreBreakdown.total === null}>正式结算并保存</button> : null}<button type="button" onClick={() => navigate('/experiments')}>返回实验中心</button></div>
        </section>}
      </div>
      {confirmingSubmit ? <ConfirmDialog title="确认正式交卷" description={`当前还有 ${questions.length - answeredCount} 道题未作答，未作答题目将计 0 分。交卷后不能修改答案。`} onCancel={() => setConfirmingSubmit(false)} onConfirm={() => { setConfirmingSubmit(false); void submitFinalExam(); }} confirmLabel="确认交卷" /> : null}
      {confirmingRestart ? <ConfirmDialog title="重新开始实验一" description="当前实验配置、检查进度和飞行数据将被重置。" onCancel={() => setConfirmingRestart(false)} onConfirm={async () => { setConfirmingRestart(false); await restartExperiment(); }} confirmLabel="确认重置" /> : null}
    </PanelShell>
  </div>;
}
