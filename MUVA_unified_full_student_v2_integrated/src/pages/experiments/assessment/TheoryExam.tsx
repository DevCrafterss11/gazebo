import { useEffect, useState } from 'react';
import type { ExperimentRun } from '../../../domain/assessment/model';
import type { TheoryExamAttempt } from '../../../domain/assessment/exam';
import { useAssessmentStore } from '../../../stores/assessmentStore';
import styles from './AssessmentPage.module.css';
import examStyles from './AssessmentExam.module.css';

const typeNames = { single: '单项选择', multiple: '多项选择', boolean: '判断题', scenario: '情景分析选择题' };

export function ExamReview({ attempt, wrongOnly = false }: { attempt: TheoryExamAttempt; wrongOnly?: boolean }) {
  if (attempt.status !== 'SUBMITTED') return <p>正式考核在交卷后显示答案与解析。</p>;
  const questions = attempt.questionSnapshot.filter((question) => !wrongOnly || attempt.results.some((result) => result.questionId === question.id && !result.correct));
  return <div>{questions.length === 0 && <p>全部题目回答正确，没有错题。</p>}{questions.map((question, index) => {
    const result = attempt.results.find((item) => item.questionId === question.id);
    return <article className={examStyles.reviewQuestion} key={question.id}><h3>{index + 1}. {question.prompt}</h3><p>{question.domain} · {result?.earnedPoints ?? 0}/{question.points} 分 · {result?.correct ? '回答正确' : '需复习'}</p>{question.context && <p className={examStyles.context}>{question.context}</p>}<p>学生答案：{result?.selectedAnswers.join('；') || '未作答'}</p><p>标准答案：{question.correctAnswers.join('；')}</p><p>解析：{question.rationale}</p></article>;
  })}</div>;
}

export function TheoryExam({ run, remaining }: { run: ExperimentRun; remaining: number }) {
  const { startExam, answerExam, selectExamQuestion, submitExam } = useAssessmentStore();
  const [confirmation, setConfirmation] = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);
  const attempt = run.theoryExam;
  const question = attempt.questionSnapshot[attempt.currentQuestionIndex];
  const answered = attempt.questionSnapshot.filter((item) => (attempt.answers[item.id]?.length ?? 0) > 0).length;
  useEffect(() => setShowExplanation(false), [question?.id]);
  if (attempt.status === 'NOT_STARTED') return <section className={styles.panel}><h2>理论考卷 · 综合飞行实验终结性测验</h2><p>10 道题 · 总分 100 分 · 限时 20 分钟 · 占综合成绩 30%</p><p>4 道单选、2 道多选、2 道判断、2 道情景题。多选题须全部正确，漏选、多选均不得分。</p><p>情景题关联本次悬停指标和诊断记录；缺少记录时采用统一标准情境，不改变标准答案与题目分值。</p><p className={examStyles.notice}>考卷开始后实操数据锁定；刷新不会重置计时。到时自动交卷，未答题计 0 分。{run.configuration.trainingMode === 'guided' ? '当前为引导学习模式，可在答题后主动查看解析。' : '当前为正式/自主考核，交卷前不显示标准答案或解析。'}</p><button className={styles.primary} onClick={startExam}>开始理论考核</button><p>纯前端 Mock 仅供教学演示，不具备真实防篡改或防作弊能力。</p></section>;
  if (attempt.status === 'SUBMITTED') return <section className={styles.panel}><h2>理论考核已交卷 · {attempt.score?.toFixed(1)} / 100</h2><p>提交方式：{attempt.submissionReason === 'timeout' ? '到时自动提交' : '学生确认交卷'} · 提交后答案与评分锁定</p><ExamReview attempt={attempt}/></section>;
  if (!question) return <section className={styles.panel}>考卷快照缺失，请重新开始实验。</section>;
  const selected = attempt.answers[question.id] ?? [];
  const toggle = (option: string) => answerExam(question.id, question.type === 'multiple' ? selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option] : [option]);
  return <><div className={examStyles.examGrid}>
    <section className={`${styles.panel} ${examStyles.question}`}>
      <div className={examStyles.questionHeader}><strong>第 {attempt.currentQuestionIndex + 1} / {attempt.questionSnapshot.length} 题</strong><span role="timer" aria-label="理论考卷剩余时间">剩余 {String(Math.floor(remaining / 60)).padStart(2, '0')}:{String(remaining % 60).padStart(2, '0')}</span></div>
      <p>{typeNames[question.type]} · {question.points} 分 · {question.domain}</p><h3>{question.prompt}</h3>
      {question.context && <div className={examStyles.context}>{question.context}</div>}
      <div className={examStyles.options} role="group" aria-label="题目选项">{question.options.map((option, index) => <label key={option} className={examStyles.option}><input type={question.type === 'multiple' ? 'checkbox' : 'radio'} name={question.id} checked={selected.includes(option)} onChange={() => toggle(option)}/><span>{String.fromCharCode(65 + index)}. {option}</span></label>)}</div>
      <div className={styles.toolbar}><button disabled={attempt.currentQuestionIndex === 0} onClick={() => selectExamQuestion(attempt.currentQuestionIndex - 1)}>上一题</button><button disabled={attempt.currentQuestionIndex === attempt.questionSnapshot.length - 1} onClick={() => selectExamQuestion(attempt.currentQuestionIndex + 1)}>下一题</button><span className={examStyles.badge}>答题后自动保存</span></div>
      {run.configuration.trainingMode === 'guided' && selected.length > 0 && <><button onClick={() => setShowExplanation(!showExplanation)}>{showExplanation ? '收起教学解析' : '查看教学解析'}</button>{showExplanation && <div className={examStyles.explanation}>标准答案：{question.correctAnswers.join('；')}<br/>解析：{question.rationale}</div>}</>}
    </section>
    <aside className={styles.panel}><h2>答题卡</h2><div className={examStyles.answerCard}>{attempt.questionSnapshot.map((item, index) => <button key={item.id} aria-label={`第 ${index + 1} 题`} aria-current={index === attempt.currentQuestionIndex ? 'true' : undefined} data-answered={(attempt.answers[item.id]?.length ?? 0) > 0} onClick={() => selectExamQuestion(index)}>{index + 1}</button>)}</div><p>已答 {answered} / {attempt.questionSnapshot.length}</p><p>绿色：已答 · 普通：未答</p><p>{attempt.contextSummary}</p><button className={styles.primary} onClick={() => setConfirmation(true)}>提交理论考卷</button></aside>
  </div>{confirmation && <div className={examStyles.modalBackdrop}><section className={examStyles.dialog} role="dialog" aria-modal="true" aria-labelledby="exam-submit-heading"><h2 id="exam-submit-heading">确认交卷</h2><p>已答 {answered} / {attempt.questionSnapshot.length}，未答 {attempt.questionSnapshot.length - answered} 题。交卷后不能修改答案。</p><div className={styles.toolbar}><button onClick={() => setConfirmation(false)}>继续答题</button><button className={styles.primary} onClick={() => { setConfirmation(false); submitExam(); }}>确认提交考卷</button></div></section></div>}</>;
}
