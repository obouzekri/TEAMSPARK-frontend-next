'use client';

import React, { useEffect, useMemo, useState } from 'react';
import useRealtimeChallenge from '@/lib/challenges/useRealtimeChallenge';
import { refreshChallengeStateBeforeStart } from '@/lib/challenges/useRealtimeChallenge';
import useChallengeChat from '@/lib/challenges/useChallengeChat';
import { DEFAULT_CHALLENGE_QUICK_MESSAGES } from '@/lib/challenges/chat-presets';
import { getMissionCritiqueRulesPreset } from '@/lib/challenges/missionCritiqueRules';
import ChallengeTimerCard from '../ChallengeTimerCard';
import ChallengeChatCard from '../ChallengeChatCard';
import ChallengeRulesPanel from '../ChallengeRulesPanel';
import ChallengeHeader from '../ChallengeHeader';
import useI18n from '@/lib/i18n/useI18n';
import styles from './MissionCritique.module.css';

const PHASES = Object.freeze([
  { key: 'cadrage', label: 'Cadrage', className: 'phaseCadrage' },
  { key: 'preparation', label: 'Préparation', className: 'phasePreparation' },
  { key: 'execution', label: 'Exécution', className: 'phaseExecution' },
  { key: 'cloture', label: 'Clôture', className: 'phaseCloture' },
]);

function inferPhaseKey(index, total) {
  const safeTotal = Math.max(1, Number(total || 1));
  const ratio = Number(index || 0) / safeTotal;
  if (ratio < 0.25) return 'cadrage';
  if (ratio < 0.5) return 'preparation';
  if (ratio < 0.75) return 'execution';
  return 'cloture';
}

function phaseLabel(phase, isEn) {
  if (!isEn) return phase.label;
  if (phase.key === 'cadrage') return 'Scoping';
  if (phase.key === 'preparation') return 'Preparation';
  if (phase.key === 'execution') return 'Execution';
  return 'Closure';
}

function normalizeName(value) {
  return String(value || '').trim();
}

function isEmailLike(value) {
  return normalizeName(value).includes('@');
}

export default function MissionCritiqueChallenge({ engineKey, runtimePayload, socket, context, onChallengeCompleted }) {
  const { locale } = useI18n();
  const isEn = locale === 'en';
  const [activePhase, setActivePhase] = useState('cadrage');
  const [modalTaskId, setModalTaskId] = useState('');
  const [submitResult, setSubmitResult] = useState(null);

  const {
    state,
    error,
    isFacilitator,
    emitEvent,
  } = useRealtimeChallenge({ runtimePayload, socket, context, onChallengeCompleted });

  const mission = state?.mission || {};
  const tasks = Array.isArray(mission.tasks) ? mission.tasks : [];
  const timeline = Array.isArray(mission.timeline) ? mission.timeline : [];
  const facilitatorBoard = Array.isArray(mission.facilitator_board) ? mission.facilitator_board : [];
  const collectiveResult = mission.collective_result || null;

  const displayName = useMemo(() => {
    const firstName = String(runtimePayload?.context?.firstName || runtimePayload?.context?.first_name || context?.firstName || context?.first_name || '').trim();
    const lastName = String(runtimePayload?.context?.lastName || runtimePayload?.context?.last_name || context?.lastName || context?.last_name || '').trim();
    const fullName = `${firstName} ${lastName}`.trim();
    if (fullName) return fullName;

    const fromPayload = String(runtimePayload?.context?.displayName || runtimePayload?.context?.name || '').trim();
    if (fromPayload && !isEmailLike(fromPayload)) return fromPayload;

    const fallbackName = String(context?.displayName || context?.name || '').trim();
    if (fallbackName && !isEmailLike(fallbackName)) return fallbackName;

    return 'Participant';
  }, [runtimePayload, context]);

  function resolveParticipantLabel(item) {
    const firstName = String(item?.first_name || item?.firstName || '').trim();
    const lastName = String(item?.last_name || item?.lastName || '').trim();
    const fullName = `${firstName} ${lastName}`.trim();
    if (fullName) return fullName;

    const fromPayload = String(item?.display_name || item?.participant_name || item?.name || '').trim();
    if (fromPayload && !isEmailLike(fromPayload)) return fromPayload;
    if (Number.isFinite(Number(item?.slot))) return `Participant ${item.slot}`;
    return 'Participant';
  }

  const {
    chatInput,
    setChatInput,
    chatMessages,
    submitChat,
    sendQuickChat,
  } = useChallengeChat({
    socket,
    emitEvent,
    author: displayName,
    enabled: true,
    maxMessages: 80,
    maxLength: 240,
  });

  const taskMap = useMemo(() => {
    const map = new Map();
    tasks.forEach((task) => map.set(String(task.id), task));
    return map;
  }, [tasks]);

  const timelineSet = useMemo(() => new Set(timeline.map((taskId) => String(taskId))), [timeline]);

  // Keep the exact server order in backlog. No client-side sort.
  const backlogTasks = useMemo(() => tasks, [tasks]);

  const timerState = String(state?.timer?.status || 'idle').trim();
  const normalizedTimerState = timerState.toLowerCase();
  const hasChallengeStarted = state?.timer?.enabled === false
    || normalizedTimerState === 'running'
    || normalizedTimerState === 'paused'
    || normalizedTimerState === 'completed'
    || normalizedTimerState === 'stopped'
    || normalizedTimerState === 'timeout';
  const canEditTimeline = !isFacilitator && (state?.timer?.enabled === false || timerState === 'running');

  const timerRemainingSeconds = Math.max(0, Number(state?.timer?.remaining_seconds || 0));
  const timerDurationSeconds = Math.max(1, Number(state?.timer?.duration_seconds || 1));
  const rulesPreset = useMemo(() => getMissionCritiqueRulesPreset(locale), [locale]);
  const rulesContent = useMemo(() => ({
    objective: rulesPreset.objective,
    facilitator: [...rulesPreset.facilitator],
    participant: [...rulesPreset.participant, ...rulesPreset.scoring],
    footnote: rulesPreset.footnote,
  }), [rulesPreset]);
  const challengeName = String(rulesPreset?.challengeName || 'Mission Critique').trim();
  const challengeSubtitle = String(rulesPreset?.subtitle || '').trim();
  const rulesParticipantsMeta = useMemo(() => ({
    min: rulesPreset.participants.min,
    recommended: rulesPreset.participants.recommended,
    max: rulesPreset.participants.max,
  }), [rulesPreset]);

  const facilitatorRules = useMemo(() => {
    const baseRules = Array.isArray(rulesContent?.facilitator) ? rulesContent.facilitator : [];
    return [
      ...baseRules,
      isEn
        ? 'Scoring (transparent): team score = average of individual scores (0 to 100).'
        : 'Calcul du score (transparent): score collectif = moyenne des scores individuels (0 à 100).',
      isEn
        ? 'Penalties: unmet dependency (-8), missing critical task (-10), duplicate (-5), unknown task (-3).'
        : 'Pénalités: dépendance non respectée (-8), tâche critique manquante (-10), doublon (-5), tâche inconnue (-3).',
      isEn
        ? 'Simplified formula: 100 - penalties + consistency bonus (clamped from 0 to 100).'
        : 'Formule backend: 100 - pénalités (borné entre 0 et 100).',
      isEn
        ? 'The team must converge and submit one coherent collective timeline.'
        : 'L’équipe doit converger puis soumettre une seule timeline cohérente au niveau collectif.',
      isEn
        ? 'Distribute tasks by phase (scoping, preparation, execution, closure) to balance workload.'
        : 'Répartissez les tâches par phase (cadrage, préparation, exécution, clôture) pour équilibrer la charge.',
      isEn
        ? 'Assign a dependency owner to validate prerequisites before each major move.'
        : 'Affectez un responsable dépendances pour valider les prérequis avant chaque déplacement majeur.'
    ];
  }, [rulesContent?.facilitator, isEn]);

  const participantRules = useMemo(() => {
    const baseRules = Array.isArray(rulesContent?.participant) ? rulesContent.participant : [];
    return [
      ...baseRules,
      isEn
        ? 'Final score is collective: your ordering directly impacts the whole team average.'
        : 'Le score final est collectif: votre ordre impacte directement la moyenne de toute l’équipe.',
      isEn
        ? 'Scoring: 100 base points, then deductions for inconsistencies (dependencies, missing critical tasks, duplicates).'
        : 'Calcul du score: 100 points de base puis retraits en cas d’incohérences (dépendances, tâches critiques manquantes, doublons, tâches inconnues).',
      isEn
        ? 'Coordinate to submit one unique and coherent timeline for the entire team.'
        : 'Synchronisez-vous pour soumettre une timeline unique et cohérente pour toute l’équipe.',
      isEn
        ? 'Prioritize dependencies and critical tasks first, then complete the remaining backlog.'
        : 'Priorisez d’abord les dépendances et les tâches critiques, puis complétez le reste du backlog.'
    ];
  }, [rulesContent?.participant, isEn]);

  // Phases come from the server (persisted per task). Ratio inference is only
  // a fallback for legacy timelines that predate server-side phase storage.
  const serverPhases = useMemo(
    () => (mission.phases && typeof mission.phases === 'object' ? mission.phases : {}),
    [mission.phases]
  );

  const phaseOfTask = useMemo(() => (taskId, timelineIndex = 0) => {
    const raw = String(serverPhases[String(taskId)] || '').trim();
    if (PHASES.some((phase) => phase.key === raw)) return raw;
    return inferPhaseKey(timelineIndex, timeline.length);
  }, [serverPhases, timeline.length]);

  const phaseItems = useMemo(() => {
    const buckets = PHASES.reduce((acc, phase) => {
      acc[phase.key] = [];
      return acc;
    }, {});

    timeline.forEach((taskId, timelineIndex) => {
      const id = String(taskId);
      const phaseKey = phaseOfTask(id, timelineIndex);
      const safePhaseKey = buckets[phaseKey] ? phaseKey : 'cloture';
      buckets[safePhaseKey].push({
        taskId: id,
        timelineIndex,
      });
    });

    return buckets;
  }, [phaseOfTask, timeline]);

  const activePhaseItems = phaseItems[activePhase] || [];

  const modalTask = modalTaskId ? taskMap.get(String(modalTaskId)) : null;
  const modalAssignedPhase = modalTask && timelineSet.has(String(modalTask.id))
    ? phaseOfTask(modalTask.id, timeline.indexOf(modalTask.id))
    : '';

  useEffect(() => {
    if (!modalTaskId) return () => {};
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setModalTaskId('');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modalTaskId]);

  useEffect(() => {
    if (!socket) return () => {};

    const onEvent = (packet = {}) => {
      const type = String(packet?.type || '').trim();
      const payload = packet?.payload || {};

      if (type === 'mission.completed' && payload?.result) {
        setSubmitResult(payload.result);
      }
    };

    socket.on('challenge:event', onEvent);
    return () => {
      socket.off('challenge:event', onEvent);
    };
  }, [socket]);

  function openTaskModal(taskId) {
    if (!canEditTimeline) return;
    setModalTaskId(String(taskId));
  }

  function closeTaskModal() {
    setModalTaskId('');
  }

  function assignTaskToPhase(taskId, phaseKey) {
    if (!canEditTimeline) return;
    const id = String(taskId);
    const safePhase = PHASES.some((phase) => phase.key === phaseKey) ? phaseKey : 'cloture';
    const currentPhase = timelineSet.has(id) ? phaseOfTask(id, timeline.indexOf(id)) : '';
    if (currentPhase === safePhase) {
      closeTaskModal();
      return;
    }
    if (currentPhase) {
      emitEvent('mission.task.remove', { taskId: id });
    }
    emitEvent('mission.task.add', { taskId: id, phase: safePhase });
    closeTaskModal();
  }

  function removeTaskFromTimeline(taskId) {
    if (!canEditTimeline) return;
    emitEvent('mission.task.remove', { taskId: String(taskId) });
    closeTaskModal();
  }

  function submitTimeline() {
    emitEvent('mission.submit');
  }

  function moveTaskWithinPhase(fromTimelineIndex, targetTimelineIndex) {
    if (!canEditTimeline) return;
    if (!Number.isInteger(fromTimelineIndex) || !Number.isInteger(targetTimelineIndex)) return;
    if (fromTimelineIndex === targetTimelineIndex) return;
    emitEvent('mission.task.move', {
      fromIndex: fromTimelineIndex,
      toIndex: targetTimelineIndex,
    });
  }

  const roleViewClass = isFacilitator ? styles.facilitatorView : styles.participantView;

  function handleStartChallenge() {
    refreshChallengeStateBeforeStart(emitEvent);
    emitEvent('timer.start');
  }

  return (
    <div className={`${styles.container} ${roleViewClass}`}>
      <ChallengeHeader
        title={challengeName}
        subtitle={challengeSubtitle || String(state?.config?.scenario || runtimePayload?.config?.scenario || 'Organiser un séminaire d’entreprise pour 80 personnes.')}
        headerAction={hasChallengeStarted ? (
          <ChallengeRulesPanel
            inHeader
            isStarted={hasChallengeStarted}
            isFacilitator={isFacilitator}
            showPrestartCard={false}
            challengeName={challengeName}
            objective={rulesContent.objective}
            participantsMeta={rulesParticipantsMeta}
            facilitatorRules={facilitatorRules}
            participantRules={participantRules}
            footnote={rulesContent.footnote}
          />
        ) : null}
      />

      <div className="challenge-mobile-timer">
        <ChallengeTimerCard
          title={isEn ? 'Timer' : 'Chrono'}
          remainingSeconds={timerRemainingSeconds}
          durationSeconds={timerDurationSeconds}
          status={timerState}
          isFacilitator={isFacilitator}
        />
      </div>

      <div className={styles.layout}>
        <main className={styles.mainPane}>
          {!hasChallengeStarted ? (
            <section className={styles.card}>
              <ChallengeRulesPanel
                isStarted={false}
                isFacilitator={isFacilitator}
                challengeName={challengeName}
                objective={rulesContent.objective}
                participantsMeta={rulesParticipantsMeta}
                facilitatorRules={facilitatorRules}
                participantRules={participantRules}
                footnote={rulesContent.footnote}
                onStart={isFacilitator ? handleStartChallenge : null}
              />
            </section>
          ) : !isFacilitator ? (
            <>
              <section className={styles.card}>
                <div className={styles.stepperHead}>
                  <div>
                    <h2>{isEn ? 'My timeline' : 'Ma timeline'}</h2>
                    <p>{isEn ? 'Assign tasks from the backlog, then order them inside each phase.' : 'Affectez les tâches depuis le backlog, puis ordonnez-les dans chaque phase.'}</p>
                  </div>
                  <button
                    type="button"
                    className={`${styles.primaryBtn} ${styles.primaryBtnCompact}`}
                    onClick={submitTimeline}
                    disabled={!canEditTimeline || timeline.length === 0}
                  >
                    {isEn ? 'Submit my solution' : 'Valider ma solution'}
                  </button>
                </div>

                <div className={styles.stepper} role="tablist" aria-label={isEn ? 'Timeline phases' : 'Phases de la timeline'}>
                  {PHASES.map((phase, phaseIdx) => {
                    const count = (phaseItems[phase.key] || []).length;
                    const isActive = activePhase === phase.key;
                    return (
                      <button
                        key={phase.key}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        className={`${styles.stepperStep} ${styles[phase.className]}${isActive ? ` ${styles.stepperStepActive}` : ''}`}
                        onClick={() => setActivePhase(phase.key)}
                      >
                        <span className={styles.stepDot}>{phaseIdx + 1}</span>
                        <span className={styles.stepLabel}>{phaseLabel(phase, isEn)}</span>
                        <span className={styles.stepCount}>{count}</span>
                      </button>
                    );
                  })}
                </div>

                <div className={styles.phasePanel}>
                  {activePhaseItems.length === 0 ? (
                    <p className={styles.empty}>{isEn ? 'No task in this phase yet. Assign one from the backlog below.' : 'Aucune tâche dans cette phase. Affectez-en une depuis le backlog ci-dessous.'}</p>
                  ) : (
                    activePhaseItems.map((item, indexInPhase) => {
                      const task = taskMap.get(String(item.taskId));
                      const canMoveUp = indexInPhase > 0;
                      const canMoveDown = indexInPhase < activePhaseItems.length - 1;
                      const upTarget = canMoveUp ? activePhaseItems[indexInPhase - 1].timelineIndex : item.timelineIndex;
                      const downTarget = canMoveDown ? activePhaseItems[indexInPhase + 1].timelineIndex : item.timelineIndex;
                      return (
                        <article
                          key={`${item.taskId}-${item.timelineIndex}`}
                          className={styles.timelineCodeItem}
                        >
                          <div className={styles.timelineItemBody}>
                            <p className={styles.meta}>{task?.label || item.taskId}</p>
                          </div>
                          <div className={styles.timelineItemControls}>
                            <button
                              type="button"
                              className={styles.ghostBtn}
                              onClick={() => moveTaskWithinPhase(item.timelineIndex, upTarget)}
                              disabled={!canEditTimeline || !canMoveUp}
                              title={isEn ? 'Move up' : 'Monter'}
                              aria-label={isEn ? 'Move up in phase' : 'Monter dans la phase'}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className={styles.ghostBtn}
                              onClick={() => moveTaskWithinPhase(item.timelineIndex, downTarget)}
                              disabled={!canEditTimeline || !canMoveDown}
                              title={isEn ? 'Move down' : 'Descendre'}
                              aria-label={isEn ? 'Move down in phase' : 'Descendre dans la phase'}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              className={styles.ghostBtn}
                              onClick={() => emitEvent('mission.task.remove', { index: item.timelineIndex })}
                              disabled={!canEditTimeline}
                            >
                              {isEn ? 'Remove' : 'Retirer'}
                            </button>
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>
              </section>

              <section className={styles.card}>
                <div className={styles.sectionHead}>
                  <h2>{isEn ? 'Mission backlog' : 'Backlog mission'}</h2>
                  <p>{isEn ? 'Click a task to assign it to a phase.' : 'Cliquez sur une tâche pour l’affecter à une phase.'}</p>
                </div>

                {backlogTasks.length === 0 ? (
                  <p className={styles.empty}>{isEn ? 'No tasks available.' : 'Aucune tâche disponible.'}</p>
                ) : (
                  <div className={styles.backlogList}>
                    {backlogTasks.map((task) => {
                      const id = String(task.id);
                      const assigned = timelineSet.has(id);
                      const assignedPhaseKey = assigned ? phaseOfTask(id, timeline.indexOf(task.id)) : '';
                      const assignedPhase = PHASES.find((phase) => phase.key === assignedPhaseKey);
                      return (
                        <button
                          key={task.id}
                          type="button"
                          className={`${styles.taskRow}${assigned ? ` ${styles.taskRowAssigned}` : ''}`}
                          onClick={() => openTaskModal(id)}
                          disabled={!canEditTimeline}
                          title={String(task.label || '').trim()}
                        >
                          <span className={styles.taskRowLabel}>{task.label}</span>
                          {assignedPhase ? (
                            <span className={`${styles.phaseTag} ${styles[assignedPhase.className]}`}>
                              {phaseLabel(assignedPhase, isEn)}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              {modalTask ? (
                <div className={styles.modalOverlay} onClick={closeTaskModal} role="presentation">
                  <div
                    className={styles.modalCard}
                    role="dialog"
                    aria-modal="true"
                    aria-label={String(modalTask.label || '')}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <h3 className={styles.modalTitle}>{modalTask.label}</h3>
                    <p className={styles.modalHint}>{isEn ? 'Assign this task to a phase.' : 'Affectez cette tâche à une phase.'}</p>
                    <div className={styles.modalPhaseGrid}>
                      {PHASES.map((phase) => (
                        <button
                          key={phase.key}
                          type="button"
                          className={`${styles.modalPhaseBtn} ${styles[phase.className]}${modalAssignedPhase === phase.key ? ` ${styles.modalPhaseBtnActive}` : ''}`}
                          onClick={() => assignTaskToPhase(modalTask.id, phase.key)}
                          disabled={!canEditTimeline}
                        >
                          {phaseLabel(phase, isEn)}
                        </button>
                      ))}
                    </div>
                    <div className={styles.modalActions}>
                      {modalAssignedPhase ? (
                        <button
                          type="button"
                          className={styles.ghostBtn}
                          onClick={() => removeTaskFromTimeline(modalTask.id)}
                          disabled={!canEditTimeline}
                        >
                          {isEn ? 'Remove from timeline' : 'Retirer de la timeline'}
                        </button>
                      ) : null}
                      <button type="button" className={styles.primaryBtn} onClick={closeTaskModal}>
                        {isEn ? 'Close' : 'Fermer'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {(submitResult || mission.result) ? (
                <section className={styles.card}>
                  <h2>{isEn ? 'Result' : 'Résultat'}</h2>
                  <p className={styles.score}>{isEn ? 'Score' : 'Score'}: {Number((submitResult || mission.result)?.score || 0)}/100</p>
                  <p className={styles.meta}>{isEn ? 'Strengths' : 'Points forts'}: {((submitResult || mission.result)?.strengths || []).join(' | ') || (isEn ? 'None' : 'Aucun')}</p>
                  <p className={styles.meta}>{isEn ? 'Weaknesses' : 'Points faibles'}: {((submitResult || mission.result)?.weaknesses || []).join(' | ') || (isEn ? 'None' : 'Aucun')}</p>
                  <ul className={styles.errorList}>
                    {((submitResult || mission.result)?.errors || []).map((errMsg, idx) => (
                      <li key={`${idx}-${errMsg}`}>{errMsg}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          ) : (
            <section className={styles.card}>
              <h2>{isEn ? 'Facilitator global view' : 'Vue globale facilitateur'}</h2>
              {collectiveResult ? (
                <p className={styles.score}>{isEn ? 'Collective score' : 'Score collectif'}: {Number(collectiveResult.score || 0)}/100</p>
              ) : null}
              {facilitatorBoard.length === 0 ? (
                <p className={styles.empty}>{isEn ? 'No active participants yet.' : 'Aucun participant actif pour le moment.'}</p>
              ) : (
                <div className={styles.boardGrid}>
                  {facilitatorBoard.map((item) => (
                    <article key={item.participant_id} className={styles.facilitatorCard}>
                      <p className={styles.order}>{isEn ? 'Participant' : 'Participant'}</p>
                      <h3>{resolveParticipantLabel(item)}</h3>
                      <p className={styles.meta}>{isEn ? 'Timeline' : 'Timeline'}: {item.timeline_length} {isEn ? 'tasks' : 'tâches'}</p>
                      <p className={styles.meta}>{isEn ? 'Submitted' : 'Soumis'}: {item.submitted ? (isEn ? 'Yes' : 'Oui') : (isEn ? 'No' : 'Non')}</p>
                      <p className={styles.meta}>{isEn ? 'Errors' : 'Erreurs'}: {item.errors_count ?? 0}</p>
                      <div className={styles.participantTimelineBlock}>
                        <p className={styles.miniTitle}>{isEn ? 'Real-time timeline' : 'Timeline temps réel'}</p>
                        {Array.isArray(item.timeline) && item.timeline.length > 0 ? (
                          <div className={styles.phaseTimeline}>
                            {PHASES.map((phase) => {
                              const itemPhases = item.phases && typeof item.phases === 'object' ? item.phases : {};
                              const facPhaseItems = item.timeline
                                .map((taskId, idx) => ({ taskId, idx }))
                                .filter((entry) => {
                                  const stored = String(itemPhases[String(entry.taskId)] || '').trim();
                                  const phaseKey = PHASES.some((p) => p.key === stored)
                                    ? stored
                                    : inferPhaseKey(entry.idx, item.timeline.length);
                                  return phaseKey === phase.key;
                                });

                              return (
                                <React.Fragment key={`${item.participant_id}-${phase.key}`}>
                                  <section className={`${styles.phaseLine} ${styles[phase.className]}`}>
                                    <div className={styles.phaseLineHeader}>
                                      <h3>{phaseLabel(phase, isEn)}</h3>
                                      <span>{facPhaseItems.length}</span>
                                    </div>
                                  </section>
                                  <section className={styles.timelineLane}>
                                    {facPhaseItems.length === 0 ? (
                                      <div className={styles.timelineLaneHint}>{isEn ? 'No action' : 'Aucune action'}</div>
                                    ) : (
                                      facPhaseItems.map((entry) => {
                                        const task = taskMap.get(String(entry.taskId));
                                        return (
                                          <article
                                            key={`${item.participant_id}-${phase.key}-${entry.taskId}-${entry.idx}`}
                                            className={styles.timelineCodeItem}
                                          >
                                            <div className={styles.timelineItemBody}>
                                              <p className={styles.meta}>{task?.label || String(entry.taskId)}</p>
                                            </div>
                                          </article>
                                        );
                                      })
                                    )}
                                  </section>
                                </React.Fragment>
                              );
                            })}
                          </div>
                        ) : (
                          <p className={styles.meta}>{isEn ? 'No action placed yet.' : 'Aucune action placée pour le moment.'}</p>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}

          {error ? <p className={styles.error}>{error}</p> : null}
        </main>

        <aside className={styles.sidebar}>
          <div className="challenge-desktop-timer">
            <ChallengeTimerCard
              title={isEn ? 'Timer' : 'Chrono'}
              remainingSeconds={timerRemainingSeconds}
              durationSeconds={timerDurationSeconds}
              status={timerState}
              isFacilitator={isFacilitator}
            />
          </div>

          <ChallengeChatCard
            title={isEn ? 'Chat' : 'Chat'}
            messages={chatMessages}
            currentAuthor={displayName}
            inputValue={chatInput}
            onInputChange={setChatInput}
            onSubmit={submitChat}
            quickMessages={DEFAULT_CHALLENGE_QUICK_MESSAGES}
            onQuickMessage={sendQuickChat}
            maxLength={240}
          />
        </aside>
      </div>
    </div>
  );
}
