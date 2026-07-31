# Graph Report - .  (2026-07-31)

## Corpus Check
- Large corpus: 793 files · ~621,094 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 4833 nodes · 12817 edges · 225 communities (193 shown, 32 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 263 edges (avg confidence: 0.76)
- Token cost: 568,244 input · 0 output

## Community Hubs (Navigation)
- Program Review & Placement
- Account & Auth API
- Shared Domain Types
- Grading & Review Helpers
- Criteria & Rubric Templates
- Criteria API
- РПД Monitor
- Courses & Content API
- Live Sessions & RAG Chunks
- Assignments Service
- Contact & Marketing
- App Routes & Tasks
- FGOS Competency Linking
- Test DB Setup
- Curriculum Analysis API
- Institution & Audit API
- Grading & Feedback Library API
- Pricing & Payments
- RAG Assignment Matching
- Org Unit Queries
- LTI Deep Linking
- Long Review (ВКР) Service
- Document Chunking
- Institution Queries
- LLM Cost & Criteria Assist
- Courses API
- Assignment Approval
- Plan Limits & Yandex Cost
- Published Assignments API
- Load Test Seeding & Org Units
- Program Queries
- Presentation & Quiz Components
- Leadership Queries
- Teacher Queries
- Public Feedback Widget
- DB Connection & Test Cleanup
- File Upload Validation
- Unit Economics
- Program Topology Queries
- Sidebar Navigation
- FGOS Standard Queries
- RPD Submission Queries
- Program Content Units
- Document Coverage Review
- Marketing Export & Password Reset
- Feature Spend Cap
- Backend Dependencies (Storage)
- Backend Dev Dependencies
- Confidence Config
- Rubric Queries
- Institution Structure Page
- Document & Syllabus Chunks
- Admin API
- RPD Dept Mapping Fix Script
- Published Assignment Queries
- RPD Monitor Service
- Presentation Export (PPTX)
- Institution Strategy Docs
- Email Templates
- Sveden.ru Parser
- Domain Access Gating
- Program Market Evidence
- Usage Logging
- Admin Eval Calibration
- Citation Checker & Topics
- UMC Dashboard
- Frontend TS Config
- Embeddings Backfill
- Contact Messages Queries
- Criteria Queries
- FOS Documents & Tasks
- Backend NPM Scripts
- Eval Runs & Confidence
- BRS Queries
- FOS Documents Service
- Architecture & Design Rationale
- Provider Rate Ceilings
- Admin Institution API
- Usage Rollup Backfill
- Presentation Eval Harness
- Activation Funnel Queries
- CLAUDE.md Rules & Architecture
- Frontend Dependencies
- Frontend Dev Dependencies
- Leadership API
- SAML Verification
- Citation & Feedback Prompt Building
- Backend TS Config
- Capacity & Resource Monitoring
- Score Calibration Queries
- Prompt Injection Sanitiser
- Curriculum Analysis Service
- Incident Logging & Alerts
- Org Tree Role Scopes
- Admin Teacher Subscriptions
- Live Sessions API
- LTI API
- Job Queue (pg-boss)
- Grade Jobs
- Presentation Jobs
- Score Calibration Lib
- BRS Scheme Service
- CLAUDE.md Non-Negotiable Rules
- Root Package Config
- Support Ops Docs
- Org Structure API
- Presentation Queries
- Deployment & Backup Docs
- Presentations API
- Submission Queue & Market Evidence API
- Public Student Write API
- Usage Counters Middleware
- Cohort Synthesis
- Teacher & Notification Lookup
- Feature Spend Cap Cache
- RPD Report Excel Export
- Research Paper: Grading System
- BRS API
- Eval Runner
- Yandex Images Testing
- Course Queries
- RAG Retrieval Metrics
- VM Tuning Ops
- Admin Usage Dashboard
- Institution Contract Queries
- Syllabus Author Service
- Calc Answer Verifier
- FOS Coverage Check
- Admin Capacity Page
- Audit Log Queries
- LTI Line Item Queries
- Policy Memo Queries
- Invite & Consent Queries
- RPD Snapshot Records
- Cohort Analytics
- Program Report PDF
- 152-ФЗ Legal Docs
- Grading Feature Docs
- Program Document Queries
- Program Access Middleware
- Usage Ledger Feature Notes
- RPD Approval Workflow Docs
- Long Review Feature Docs
- Database Backup Script
- Object Storage Service
- DeepSeek Provider Tests
- RAG Flywheel & Scaling Docs
- Word Extractor Types
- Email Templates & AI Governance Rule
- Frontend Package Config
- Slide HTML Rendering
- LTI Course Link Queries
- Feedback Challenge UI Screenshot
- Admin Audit Page
- Admin Payments Page
- Math (KaTeX) Rendering
- Draft Encryption
- TipTap Text Extraction
- Postgres Rate Limit Store
- Admin Activation Funnel Page
- Frontend Deploy Upload Script
- Document Review Queries
- Placement Review Queries
- Backend Package Overrides
- MTO Review Queries
- Test Transaction Isolation
- Provenance Computation
- Grading Critique Form Screenshot
- Admin Contact Messages Page
- Org Member Roles API
- Org Tree Types
- Service Worker Update Toast
- SAML SP Keypair Script
- DB Migration Script
- Program Document Diffs
- AI Feedback Panel Screenshot
- Load Test Dashboard (k6)
- KaTeX Type Shim
- Password Reset Script
- Confidence Eval Script
- Yandex Vision Tests
- Frontend Entry Point
- Autoprefixer Dependency
- Cookie Parser Dependency
- docx Dependency
- Express Dependency
- Rate Limit Dependency
- Mammoth (docx parsing) Dependency
- Nodemailer Dependency
- pdf-parse Dependency
- PDFKit Dependency
- pg Driver Dependency
- Deploy Script
- Deploy Script (deploy/)
- VM Setup Script
- РУМЦ Report Publication
- Framer Motion Dependency
- QR Code Dependency
- TipTap React Dependency
- PostCSS Dependency
- React Types Dependency
- PWA Plugin Dependency
- Apple Touch Icon & Brand
- App Icon 192px & Brand
- VM Setup Script (root)
- App Icon 512px
- App Icon SVG
- Platform-Generic Design Principle

## God Nodes (most connected - your core abstractions)
1. `useUIStore` - 138 edges
2. `pool` - 120 edges
3. `sanitiseForPrompt()` - 85 edges
4. `logger` - 69 edges
5. `Button()` - 55 edges
6. `useAuthStore` - 54 edges
7. `getCourses()` - 45 edges
8. `ValidationError` - 40 edges
9. `authenticate()` - 40 edges
10. `createTestTeacher()` - 38 edges

## Surprising Connections (you probably didn't know these)
- `5.1.2 152-ФЗ and the telemetry data class constraint` --semantically_similar_to--> `Описание изобретения (patent filing draft)`  [INFERRED] [semantically similar]
  Research.md → описание изобретения.txt
- `5.1 Process-of-creation attestation` --semantically_similar_to--> `Описание изобретения (patent filing draft)`  [INFERRED] [semantically similar]
  Research.md → описание изобретения.txt
- `2.5 Tamper-evident grade attestation` --semantically_similar_to--> `Описание изобретения (patent filing draft)`  [INFERRED] [semantically similar]
  Research.md → описание изобретения.txt
- `Options: self-host R1-Distill-Qwen-32B / anonymize / consent+disclosure` --semantically_similar_to--> `3.8 Small fine-tuned Russian pedagogical model`  [INFERRED] [semantically similar]
  docs/TODO-ai-data-residency.md → Research.md
- `Options: self-host R1-Distill-Qwen-32B / anonymize / consent+disclosure` --semantically_similar_to--> `3.7 On-premises / isolated-tenancy deployment`  [INFERRED] [semantically similar]
  docs/TODO-ai-data-residency.md → Research.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **'AI never final' governance pattern across rules, conventions, and process attestation** — claude_ai_never_final, claude_approval_history_append_only, docs_conventions, research_process_of_creation_attestation [INFERRED 0.85]
- **Org-tree domain-axis authorisation implemented across architecture, access matrix, and РПД workflow gating** — claude_org_tree_authorisation, docs_access_matrix, docs_architecture, docs_rpd_workflow, docs_topology_spec [EXTRACTED 1.00]
- **КНИТУ curriculum-intelligence expansion forming the platform's admin/teacher curriculum suite** — docs_knitu_roadmap, docs_knitu_feature_map, docs_topology_spec, features_curriculum_suite [INFERRED 0.85]
- **152-ФЗ Data Residency & Cross-Border Transfer Compliance Bundle** — docs_legal_152_fz_dpa, docs_legal_security_overview, docs_legal_152_fz_dpa_cross_border_transfer, docs_legal_152_fz_dpa_yandexgpt_alternative [EXTRACTED 1.00]
- **Incident Detection-to-Runbook Pipeline** — docs_support_readme_uptime_kuma, docs_support_readme_telegram_alert, docs_support_readme_production_incidents, docs_support_runbooks_readme, docs_support_readme_triage_flow [EXTRACTED 1.00]
- **gradeOnce Shared Production/Research Path** — docs_paper_article_gradeonce, docs_support_features_grading_gradeonce, docs_paper_article_replay_harness, docs_paper_readme_eval_harness_commands [INFERRED 0.90]

## Communities (225 total, 32 thin omitted)

### Community 0 - "Program Review & Placement"
Cohesion: 0.02
Nodes (111): ReviewPlacementParams, PreparedDiscipline, analyzeProgram(), AssignableTeacher, CreateProgramInput, deleteProgram(), deleteProgramDocument(), diffDiscipline() (+103 more)

### Community 1 - "Account & Auth API"
Cohesion: 0.03
Nodes (98): deleteAccount(), downloadAccountExport(), updateProfileName(), authErrorMessage(), discoverSso(), forgotPassword(), getInvite(), getMe() (+90 more)

### Community 2 - "Shared Domain Types"
Cohesion: 0.04
Nodes (105): FeedbackChallengeInsert, insertFeedbackChallenge(), FosDocumentRow, LiveSessionRow, SyllabusStudioDraftRow, LiveSessionState, nextStatus(), scoreToGrade() (+97 more)

### Community 3 - "Grading & Review Helpers"
Cohesion: 0.04
Nodes (63): q(), getBrsSchemeForCourse(), getApprovalHistory(), getAssignmentCrossUses(), getReviewByAssignment(), getStudentTrajectory(), ApprovalHistorySection(), AssignmentDetailModal() (+55 more)

### Community 4 - "Criteria & Rubric Templates"
Cohesion: 0.05
Nodes (66): createCriterionTemplate(), createFgosDraft(), createRubricTemplate(), deleteCriterionTemplate(), deleteFgosStandard(), deleteRubricTemplate(), discoverFgosvo(), FgosvoDiscoverItem (+58 more)

### Community 5 - "Criteria API"
Cohesion: 0.05
Nodes (64): createCriterion(), CriterionPayload, deleteCriterion(), getCriteria(), getCriteriaShareTargets(), getCriteriaTemplates(), improveCriterionDescription(), shareCriterion() (+56 more)

### Community 6 - "РПД Monitor"
Cohesion: 0.05
Nodes (63): s(), assignRpdDepts(), createRpdGroup(), deleteRpdSnapshot(), downloadBlob(), downloadRpdGroup(), downloadRpdMaster(), downloadRpdReminder() (+55 more)

### Community 7 - "Courses & Content API"
Cohesion: 0.06
Nodes (53): getCourses(), createLiveSession(), deletePresentation(), GenerateResponse, deleteQuiz(), generateQuiz(), getQuiz(), getQuizzes() (+45 more)

### Community 8 - "Live Sessions & RAG Chunks"
Cohesion: 0.05
Nodes (60): findRelevantChunks(), addParticipant(), advanceParticipant(), closeLiveSession(), createLiveSession(), finishLiveSession(), finishParticipant(), generateJoinCode() (+52 more)

### Community 9 - "Assignments Service"
Cohesion: 0.06
Nodes (59): AssignmentExportRow, AssignmentRow, CohortRow, InstitutionPoolContext, ReplayTarget, SimilarAssignment, StudentSummary, TrajectoryEntry (+51 more)

### Community 10 - "Contact & Marketing"
Cohesion: 0.06
Nodes (17): ContactSourcePage, ContactTopic, submitContactMessage(), unsubscribeFromMarketingEmails(), LegalLayout(), LegalLayoutProps, LegalSidebar(), PublicFooter() (+9 more)

### Community 11 - "App Routes & Tasks"
Cohesion: 0.06
Nodes (45): ALLOWED_ORIGINS, PlanTier, countTasksThisMonth(), deleteTaskSet(), getTaskSet(), listTaskSets(), countTopicsThisMonth(), deleteTopicSet() (+37 more)

### Community 12 - "FGOS Competency Linking"
Cohesion: 0.06
Nodes (55): findPublishedFgosCompetencies(), listWorkingProgrammesByDiscipline(), setCompetencyFgosLinks(), hasContentUnitsForDocument(), replaceCompetencyLinks(), replaceContentUnits(), replacePrerequisites(), findApprovedDocumentForDiscipline() (+47 more)

### Community 13 - "Test DB Setup"
Cohesion: 0.05
Nodes (42): main(), { migrate }, axios, AxiosRequestConfig, client, ERROR_MESSAGES, downloadCsv(), createFosDocument() (+34 more)

### Community 14 - "Curriculum Analysis API"
Cohesion: 0.06
Nodes (39): analyzeOverlap(), DraftCompetency, draftSyllabus(), getSavedSyllabusDraft(), reviewSyllabus(), reviewSyllabusText(), saveSyllabusDraft(), getLearningLoopSummary() (+31 more)

### Community 15 - "Institution & Audit API"
Cohesion: 0.06
Nodes (46): AuditEntry, BulkInviteResult, deleteStrategyDocument(), getAuditLog(), getDocumentDomains(), getInstitutionModel(), getInstitutionOverview(), getInstitutionTeachers() (+38 more)

### Community 16 - "Grading & Feedback Library API"
Cohesion: 0.07
Nodes (46): getBrsStudentLedger(), FeedbackHit, searchFeedbackLibrary(), CohortAnalytics, getAssignment(), getCohortAnalytics(), getGradeJob(), getGradingHistory() (+38 more)

### Community 17 - "Pricing & Payments"
Cohesion: 0.09
Nodes (47): isPurchasablePlan(), PURCHASABLE_PLANS, PurchasablePlan, AdminPaymentRow, confirmPayment(), createPayment(), findPaymentsByTeacher(), findStalePendingPayments() (+39 more)

### Community 18 - "RAG Assignment Matching"
Cohesion: 0.07
Nodes (46): findContrastingAssignment(), findSimilarAssignments(), resolveInstitutionPoolContext(), CriterionExample, sanitiseForCrossTeacherRetrieval(), checkCitations(), toCitationBullet(), clampScore() (+38 more)

### Community 19 - "Org Unit Queries"
Cohesion: 0.06
Nodes (44): main(), bulkCreateOrgUnits(), countDirectPrimaryMembers(), countRoleOnUnit(), deleteOrgUnit(), getOrgUnitById(), getOrgUnitDependents(), GRANT_DOMAINS (+36 more)

### Community 20 - "LTI Deep Linking"
Cohesion: 0.08
Nodes (40): findLtiConfigForIssuer(), consumeDeepLinkSession(), createDeepLinkSession(), getDeepLinkSession(), LtiDeepLinkSessionRow, keyId(), privateKeyPem(), toolKeyId() (+32 more)

### Community 21 - "Long Review (ВКР) Service"
Cohesion: 0.09
Nodes (43): completeLongReview(), createLongReview(), getLongReviewByAssignmentId(), getLongReviewById(), LongReviewRow, setLongReviewProgress(), setLongReviewSnapshot(), setLongReviewStatus() (+35 more)

### Community 22 - "Document Chunking"
Cohesion: 0.09
Nodes (36): countChunksForDocument(), hasAnyChunksForCourse(), RelevantChunk, ScoredChunk, autoFillImages(), buildExpansionPrompt(), buildOutlinePrompt(), chunkArray() (+28 more)

### Community 23 - "Institution Queries"
Cohesion: 0.07
Nodes (39): countInstitutionTeachers(), findInstitutionByEmailDomain(), findSamlConfigForEmailDomain(), getInstitutionDailyUsage(), getInstitutionDocumentFetchDomains(), getInstitutionOverview(), InstitutionDailyUsageRow, InstitutionOverview (+31 more)

### Community 24 - "LLM Cost & Criteria Assist"
Cohesion: 0.09
Nodes (28): calculateDeepSeekCost(), calculateQwenCost(), improveCriterionDescription(), ImproveResult, CAPABILITIES, DeepSeekAccount, DeepSeekProvider, describeError() (+20 more)

### Community 25 - "Courses API"
Cohesion: 0.09
Nodes (34): createCourse(), deleteCourse(), getPolicyMemo(), PolicyMemo, regeneratePolicyMemo(), updateCourse(), askDocument(), ChatTurn (+26 more)

### Community 26 - "Assignment Approval"
Cohesion: 0.08
Nodes (37): canUseFeature(), approveAssignment(), createAssignment(), findApprovalHistory(), findAssignmentById(), findAssignmentsByTeacher(), findAssignmentsForExport(), findCohortRows() (+29 more)

### Community 27 - "Plan Limits & Yandex Cost"
Cohesion: 0.11
Nodes (31): calculateYandexChatCostRub(), calculateYandexEmbedCostRub(), calculateYandexImageSearchCostRub(), calculateYandexVisionCostRub(), calculateYandexWebSearchCostRub(), envRateNumber(), getYandexRatesRub(), PlanLimits (+23 more)

### Community 28 - "Published Assignments API"
Cohesion: 0.09
Nodes (34): addInvite(), AssignmentInvite, CohortGap, CohortSynthesis, deleteInvite(), getCohortSynthesis(), getLtiRoster(), getPublishedAssignment() (+26 more)

### Community 29 - "Load Test Seeding & Org Units"
Cohesion: 0.13
Nodes (28): main(), app, createInstitution(), addUnitRole(), createOrgUnit(), getRootUnitForInstitution(), findPaymentByOrderId(), createProgram() (+20 more)

### Community 30 - "Program Queries"
Cohesion: 0.09
Nodes (38): findRelevantStrategyChunksScored(), AssignableTeacher, CompetencyRow, deleteProgram(), DisciplineNotificationInfo, DisciplineRow, fillDisciplineCompetencyCodesIfEmpty(), findProgram() (+30 more)

### Community 31 - "Presentation & Quiz Components"
Cohesion: 0.08
Nodes (27): PresentationRow, QuizRow, copyRich(), BodyProps, CitationRun(), CitationRunProps, formatPages(), LegacySlide (+19 more)

### Community 32 - "Leadership Queries"
Cohesion: 0.08
Nodes (28): getSubtreeActivity(), getTeacherLeadershipActivity(), getTeacherLeadershipProfile(), hasLeadershipRole(), LeadershipActivity, LeadershipProgramUnitState, LeadershipTeacherActivity, LeadershipTeacherProfile (+20 more)

### Community 33 - "Teacher Queries"
Cohesion: 0.09
Nodes (35): assignDefaultDepartmentIfUnset(), cancelTeacherSubscription(), deleteTeacher(), findOrCreateLtiTeacher(), findOrCreateSamlTeacher(), findTeacherByEmail(), findTeacherRowById(), lastSeenTouchedAt (+27 more)

### Community 34 - "Public Feedback Widget"
Cohesion: 0.09
Nodes (31): getFeedback(), FeedbackCategory, submitFeedback(), ArticleFeedback(), readVotes(), Vote, writeVote(), inline() (+23 more)

### Community 35 - "DB Connection & Test Cleanup"
Cohesion: 0.13
Nodes (18): pool, setup(), findSimilarCriterionExamples(), getFgosStandardById(), setSamlConfig(), setup(), createTestAssignment(), createTestCourse() (+10 more)

### Community 36 - "File Upload Validation"
Cohesion: 0.11
Nodes (31): main(), ALLOWED_MIME_TYPES, contentMatchesDeclaredType(), detectMimeFromBuffer(), MAGIC_BYTES, MAX_FILE_SIZE, repairUploadFilename(), uploadConfig (+23 more)

### Community 37 - "Unit Economics"
Cohesion: 0.11
Nodes (33): arg(), FREE_COST_THRESHOLDS, institutionSummary(), main(), tierDistribution(), getInstitutionById(), getInstitutionRollupForMonth(), getUsageRollupForMonth() (+25 more)

### Community 38 - "Program Topology Queries"
Cohesion: 0.08
Nodes (36): CompetencyLinkRow, ContentUnitRow, getProgramTopology(), listCompetencyLinks(), listContentUnitsByDiscipline(), listPrerequisites(), PrerequisiteRow, ReplaceCompetencyLinkInput (+28 more)

### Community 39 - "Sidebar Navigation"
Cohesion: 0.09
Nodes (24): getGradingStats(), getPresentations(), NAV_GROUPS, NavGroup, NavItem, Props, Sidebar(), OnboardingChecklist() (+16 more)

### Community 40 - "FGOS Standard Queries"
Cohesion: 0.09
Nodes (32): createFgosStandardDraft(), deleteFgosStandard(), FgosCompetencyInput, FgosCompetencyRow, FgosProfstandardRefInput, FgosProfstandardRefRow, FgosStandardInput, FgosStandardPayload (+24 more)

### Community 41 - "RPD Submission Queries"
Cohesion: 0.12
Nodes (28): supersedeWorkingProgrammeForDiscipline(), findDisciplinesForResponsibleTeacher(), EventRow, findSubmissionByDiscipline(), findSubmissionById(), findSubmissionByIdForInstitution(), getOrCreateSubmission(), listForwardedForInstitution() (+20 more)

### Community 42 - "Program Content Units"
Cohesion: 0.09
Nodes (32): ReplaceContentUnitInput, extractContentUnits(), ExtractedContentUnit, extractSectionUnits(), SECTIONS, ALLOWED_SECTIONS, buildContentBlock(), buildRequirements() (+24 more)

### Community 43 - "Document Coverage Review"
Cohesion: 0.09
Nodes (32): detectDeclaredCompetencyCodes(), reviewDocumentCoverage(), rollUp(), selectRelevantSections(), VALID_DIMENSION, VALID_STATUS, validateEvidence(), cosine() (+24 more)

### Community 44 - "Marketing Export & Password Reset"
Cohesion: 0.10
Nodes (28): csvEscape(), main(), createResetToken(), findValidToken(), generateRawToken(), hashToken(), invalidateExistingTokens(), markTokenUsed() (+20 more)

### Community 45 - "Feature Spend Cap"
Cohesion: 0.10
Nodes (30): PLAN_LIMITS, checkFeatureSpendCap(), CacheEntry, checkGlobalSpendCap(), currentDaySpend(), dailyCapUsd(), parseDailyCapUsd(), cache (+22 more)

### Community 46 - "Backend Dependencies (Storage)"
Cohesion: 0.06
Nodes (35): @aws-sdk/client-s3, dependencies, @aws-sdk/client-s3, axios, bcryptjs, cors, dotenv, exceljs (+27 more)

### Community 47 - "Backend Dev Dependencies"
Cohesion: 0.06
Nodes (35): devDependencies, dotenv-cli, pino-pretty, supertest, tsx, @types/bcryptjs, @types/cookie-parser, @types/cors (+27 more)

### Community 48 - "Confidence Config"
Cohesion: 0.12
Nodes (28): findContrastingAssignmentBefore(), ConfidenceConfig, upsertConfidenceConfig(), findConfidenceResults(), binnedCalibration(), CalibrationBin, ConfidencePair, CoveragePoint (+20 more)

### Community 49 - "Rubric Queries"
Cohesion: 0.12
Nodes (30): createGlobalRubricTemplate(), createInstitutionRubric(), createRubric(), deleteRubric(), findGlobalRubricTemplates(), findRubricByIdForTeacher(), findRubricsByInstitution(), findRubricsByTeacher() (+22 more)

### Community 50 - "Institution Structure Page"
Cohesion: 0.07
Nodes (19): AddChildForm(), CREATABLE, emptyMeta, GRANT_DOMAIN_OPTIONS, grantWarning(), INSTITUTION_WIDE_TYPES, ManageUnitPanel(), MemberRow() (+11 more)

### Community 51 - "Document & Syllabus Chunks"
Cohesion: 0.12
Nodes (27): createChunk(), deleteChunksForOtherSyllabusDocuments(), setCourseSyllabusText(), createDocument(), DocumentRow, DocumentType, getDocumentById(), getStoragePathsByTeacher() (+19 more)

### Community 52 - "Admin API"
Cohesion: 0.07
Nodes (29): AccountCeiling, AdminContactMessage, AdminError, AdminFeedback, AdminOverview, AdminPayment, AuditFilters, CapacityNoData (+21 more)

### Community 53 - "RPD Dept Mapping Fix Script"
Cohesion: 0.14
Nodes (25): AUTHORITATIVE_MAPPING, main(), resolveInstitutionId(), assignDeptsToGroup(), createDeptGroup(), createSnapshot(), deleteDeptGroup(), deleteSnapshot() (+17 more)

### Community 54 - "Published Assignment Queries"
Cohesion: 0.11
Nodes (25): addInvite(), AssignmentInviteRow, attachSubmissionToGrade(), createPublishedAssignment(), deleteInvite(), findOrCreateLtiInvite(), generateInviteToken(), getPublishedAssignment() (+17 more)

### Community 55 - "RPD Monitor Service"
Cohesion: 0.11
Nodes (26): RpdRowInput, DocumentProcessingError, decodeTriplet(), EDU_FORMS, EDU_LEVELS, fmtPct(), learnDeptCodesFromWorkbook(), parseAsuExport() (+18 more)

### Community 56 - "Presentation Export (PPTX)"
Cohesion: 0.21
Nodes (27): addBulletsSlide(), addComparisonSlide(), addConceptSlide(), addDiagramSlide(), addDiscussionSlide(), addFormulaSlide(), addHeader(), addNotes() (+19 more)

### Community 57 - "Institution Strategy Docs"
Cohesion: 0.12
Nodes (21): deleteStrategyDocument(), getStrategyDocumentByInstitution(), insertStrategyChunk(), replaceStrategyDocument(), ScoredStrategyChunk, setStrategyDocumentExtractedText(), setStrategyDocumentFailed(), setStrategyDocumentStatus() (+13 more)

### Community 58 - "Email Templates"
Cohesion: 0.26
Nodes (26): activation24hEmail(), activation72hEmail(), adminPurchaseEmail(), adminSignupEmail(), billingBtn(), btn(), contactMessageEmail(), feedbackEmail() (+18 more)

### Community 59 - "Sveden.ru Parser"
Cohesion: 0.15
Nodes (26): Anchor, attrValue(), classifyPracticeType(), cleanLinkText(), decodeEntities(), DisciplineMatch, DisciplineRef, DiscoveredDoc (+18 more)

### Community 60 - "Domain Access Gating"
Cohesion: 0.14
Nodes (23): Domain, DOMAINS, OrgUnitType, Express, Request, requireDomain(), requireDomainOnUnitTypes(), adminFlags() (+15 more)

### Community 61 - "Program Market Evidence"
Cohesion: 0.12
Nodes (21): createMarketEvidence(), getLatestMarketEvidence(), ProgramMarketEvidenceRow, StrategyExcerptRow, updateMarketEvidenceText(), fetchOneProfession(), fetchVacancySnapshot(), ProfessionSnapshot (+13 more)

### Community 62 - "Usage Logging"
Cohesion: 0.09
Nodes (24): CreateUsageLogParams, DailyUsageRow, ErrorRow, getDailyUsage(), getRecentErrors(), getTodayCost(), getUsageByFeature(), getUsageByModel() (+16 more)

### Community 63 - "Admin Eval Calibration"
Cohesion: 0.12
Nodes (23): getAdminTeachers(), applyThresholds(), CalibrationBin, ConditionSummary, ConfidenceConfig, ConfidenceLabelAgg, CoveragePoint, evalCsvUrl() (+15 more)

### Community 64 - "Citation Checker & Topics"
Cohesion: 0.14
Nodes (20): createTopicSet(), classifyMatch(), RawReference, reformulateQuery(), searchForReference(), STOP_WORDS, stripLeadingNumbering(), tokenize() (+12 more)

### Community 65 - "UMC Dashboard"
Cohesion: 0.13
Nodes (20): findReadinessRows(), ReadinessQueryRow, toRow(), institutionId(), resolveUmuPrefixes(), router, aggregateUmcDashboard(), getUmcDashboard() (+12 more)

### Community 66 - "Frontend TS Config"
Cohesion: 0.08
Nodes (25): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+17 more)

### Community 67 - "Embeddings Backfill"
Cohesion: 0.14
Nodes (19): main(), updateEmbedding(), findRelevantChunksScored(), insertCriterionExample, REASONER_MODEL, askDocument(), buildSystemPrompt(), DocChatResult (+11 more)

### Community 68 - "Contact Messages Queries"
Cohesion: 0.10
Nodes (17): ContactMessageRow, createContactMessage(), listContactMessages(), markContactMessageRead(), createFeedback(), FeedbackRow, FeedbackWithTeacher, listFeedback() (+9 more)

### Community 69 - "Criteria Queries"
Cohesion: 0.17
Nodes (19): createCriterion(), createGlobalTemplate(), CriterionRow, deleteCriterion(), findCriteriaByIds(), findCriteriaByInstitution(), findCriteriaByTeacher(), findCriteriaSharedWithTeacher() (+11 more)

### Community 70 - "FOS Documents & Tasks"
Cohesion: 0.14
Nodes (20): completeFosDocument(), setFosProgress(), setFosSections(), setFosStatus(), createTaskSet(), chunk(), extractTopicsAndCompetencies(), generateCriteria() (+12 more)

### Community 71 - "Backend NPM Scripts"
Cohesion: 0.09
Nodes (23): scripts, backfill:embeddings, backup:db, build, dev, eval, eval:confidence, eval:presentations (+15 more)

### Community 72 - "Eval Runs & Confidence"
Cohesion: 0.15
Nodes (21): findReplayTargets(), findSimilarAssignmentsBefore(), getConfidenceConfig(), completeEvalRun(), ConfidenceResultRow, createEvalRun(), EvalResultRow, EvalRun (+13 more)

### Community 73 - "BRS Queries"
Cohesion: 0.15
Nodes (19): findStudentsByTeacher(), addBrsManualEntry(), attachCheckpoints(), BrsCheckpointInput, BrsCheckpointRow, BrsGradeThresholdRow, BrsSchemePayload, BrsSchemeRow (+11 more)

### Community 74 - "FOS Documents Service"
Cohesion: 0.14
Nodes (17): createFosDocument(), getFosDocumentById(), listFosDocumentsForCourse(), updateFosSections(), router, generateFosDocx(), RunFosParams, C (+9 more)

### Community 75 - "Architecture & Design Rationale"
Cohesion: 0.11
Nodes (21): Multi-Provider LLM Registry, Published Assignments + Attestation (§5.1), Cross-border transfer to DeepSeek (152-ФЗ risk), Options: self-host R1-Distill-Qwen-32B / anonymize / consent+disclosure, Request lifecycle (middleware chain), Описание изобретения (patent filing draft), 5.1.2 152-ФЗ and the telemetry data class constraint, 5.0 Reframe — why 'better AI detection' is a trap (+13 more)

### Community 76 - "Provider Rate Ceilings"
Cohesion: 0.19
Nodes (16): AccountSummary, getAccountSummaries(), getHourlyRateLimitBuckets(), getHourlyVolume(), HourlyRateLimitBucket, HourlyVolume, AccountCeiling, computeAccountCeiling() (+8 more)

### Community 77 - "Admin Institution API"
Cohesion: 0.13
Nodes (20): AdminInstitution, createInstitution(), createInstitutionContract(), deleteInstitutionContract(), getInstitutionContracts(), getSamlConfig(), InstitutionContract, SamlConfig (+12 more)

### Community 78 - "Usage Rollup Backfill"
Cohesion: 0.19
Nodes (18): arg(), main(), monthsBack(), aggregateOverheadUsageForMonth(), aggregateTeacherUsageForMonth(), fetchPaymentsForAmortization(), upsertInstitutionRollupRow(), upsertUsageRollupRow() (+10 more)

### Community 79 - "Presentation Eval Harness"
Cohesion: 0.17
Nodes (19): arg(), DEFAULT_TOPICS, main(), avg(), countWords(), EvalTopic, mapWithConcurrency(), PresentationEvalReport (+11 more)

### Community 80 - "Activation Funnel Queries"
Cohesion: 0.15
Nodes (18): claimNudge(), findNudgeCandidates(), FunnelCohort, FunnelSummary, getFunnelByWeek(), getFunnelSummary(), NudgeCandidate, releaseNudgeClaim() (+10 more)

### Community 81 - "CLAUDE.md Rules & Architecture"
Cohesion: 0.10
Nodes (17): backend/src/services/programAnalysis.ts, api_usage_log.cost_usd now reflects real Yandex-billed cost (Improvement #13), Rule 9: Embeddings always via Yandex, Rule 10: Global audit middleware, Org Tree Authorisation (§7 / domain axis §7.10), Domain axis (platform/curriculum/teaching/umu/all), program_access axis (§5), Administration asks A1-A5 fit table (+9 more)

### Community 82 - "Frontend Dependencies"
Cohesion: 0.10
Nodes (21): dependencies, axios, katex, react, react-dom, react-router-dom, @tanstack/react-query, @tiptap/core (+13 more)

### Community 83 - "Frontend Dev Dependencies"
Cohesion: 0.10
Nodes (21): devDependencies, jsdom, tailwindcss, @testing-library/jest-dom, @testing-library/react, @types/katex, @types/react-dom, typescript (+13 more)

### Community 84 - "Leadership API"
Cohesion: 0.14
Nodes (15): getLeadershipOverview(), getLeadershipTeacher(), getLeadershipUnits(), LeadershipOverview, LeadershipProgramUnitState, LeadershipTeacher, LeadershipTeacherDrill, LeadershipUnit (+7 more)

### Community 85 - "SAML Verification"
Cohesion: 0.20
Nodes (16): check(), main(), getSamlConfig(), isSamlConfigComplete(), router, acsUrlForInstitution(), backendBaseUrl(), buildSamlForInstitution() (+8 more)

### Community 86 - "Citation & Feedback Prompt Building"
Cohesion: 0.14
Nodes (16): validateQuoteAgainstSource(), buildSystemPrompt(), buildUserPrompt(), challengeFeedback(), RawVerdict, SOURCE_LABEL, VALID_VERDICTS, extractFgosDraft() (+8 more)

### Community 87 - "Backend TS Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowSyntheticDefaultImports, esModuleInterop, forceConsistentCasingInFileNames, ignoreDeprecations, module, moduleResolution, outDir (+11 more)

### Community 88 - "Capacity & Resource Monitoring"
Cohesion: 0.22
Nodes (13): getActiveConnectionCount(), getDatabaseSizeBytes(), getEmbeddedAssignmentCount(), getLatestResourceSample(), getResourceSamplePeaks(), insertResourceSample(), InsertResourceSampleParams, pruneResourceSamples() (+5 more)

### Community 89 - "Score Calibration Queries"
Cohesion: 0.23
Nodes (17): CalibrationScopeType, getCalibration(), getScorePairsForCourse(), getScorePairsForInstitution(), getScorePairsForTeacher(), ScorePair, StoredCalibration, upsertCalibration() (+9 more)

### Community 90 - "Prompt Injection Sanitiser"
Cohesion: 0.19
Nodes (17): INJECTION_PATTERNS, sanitiseForPrompt(), buildCriteriaPrompt(), buildEvidenceBlock(), buildExamplesBlock(), buildGradingMessages(), buildHolisticPrompt(), buildLevelDescriptorLines() (+9 more)

### Community 91 - "Curriculum Analysis Service"
Cohesion: 0.20
Nodes (16): findCourseById(), getLatestKnowledgeText(), requireOwnedCourse(), resolveCourseText(), analyzeCurriculumOverlap(), classifyPairs(), cosine(), DisciplineTopics (+8 more)

### Community 92 - "Incident Logging & Alerts"
Cohesion: 0.27
Nodes (10): recordIncident(), logger, lastSentAt, sendTelegramAlert(), shouldSend(), abortMonitor(), alertAndRecordIncident(), errorHandler() (+2 more)

### Community 93 - "Org Tree Role Scopes"
Cohesion: 0.18
Nodes (12): canTeacherShareToUnit(), GrantDomain, listRoleScopesForTeacher(), teacherCanActOnUnit(), TeacherRoleScope, UnitRole, requireUnitRole(), canActOnUnit() (+4 more)

### Community 94 - "Admin Teacher Subscriptions"
Cohesion: 0.16
Nodes (15): AdminTeacher, cancelSubscription(), getInstitutions(), getTeacherPayments(), grantSubscription(), patchTeacher(), refundPayment(), AdminTeachers() (+7 more)

### Community 95 - "Live Sessions API"
Cohesion: 0.16
Nodes (13): advanceLiveSession(), finishLiveSession(), getLiveSession(), saveLiveSessionToJournal(), SaveToJournalEntry, answerWord(), LiveSessionHost(), LobbyView() (+5 more)

### Community 96 - "LTI API"
Cohesion: 0.22
Nodes (14): getLtiConfig(), getLtiRegistrationLink(), listLtiCourseLinks(), listLtiLaunches(), LtiConfig, LtiConfigPatch, LtiCourseLink, LtiDeepLinkSelectResult (+6 more)

### Community 97 - "Job Queue (pg-boss)"
Cohesion: 0.21
Nodes (11): pg-boss, failFosDocument(), failLongReview(), main(), config, registerFosWorker(), startJobQueue(), stopJobQueue() (+3 more)

### Community 98 - "Grade Jobs"
Cohesion: 0.26
Nodes (13): completeGradeJob(), failGradeJob(), getGradeJobByIdUnscoped(), GradeJobRow, setGradeJobProcessing(), GRADE_JOB_QUEUE, GradeJobPayload, QUEUE_OPTIONS (+5 more)

### Community 99 - "Presentation Jobs"
Cohesion: 0.26
Nodes (13): completePresentationJob(), failPresentationJob(), getPresentationJobByIdUnscoped(), PresentationJobRow, setPresentationJobProcessing(), PRESENTATION_JOB_QUEUE, PresentationJobPayload, QUEUE_OPTIONS (+5 more)

### Community 100 - "Score Calibration Lib"
Cohesion: 0.21
Nodes (12): applyCalibration(), Block, CalibrationMetrics, CalibrationPair, CalibrationValidationResult, clampScore(), fitIsotonicCalibration(), round2() (+4 more)

### Community 101 - "BRS Scheme Service"
Cohesion: 0.15
Nodes (15): AccrualCheckpoint, AccrualScheme, BrsDraft, BrsDraftCheckpoint, BrsGradeThreshold, CheckpointAccrual, computeStudentAccrual(), extractBrsDraft() (+7 more)

### Community 102 - "CLAUDE.md Non-Negotiable Rules"
Cohesion: 0.19
Nodes (11): Rule 2: Citation validation, Rule 8: gradeOnce is pure, Rule 6: Parameterised SQL only, Rule 4: Plan gating (canUseFeature), Rule 1: Prompt injection sanitisation, Rule 7: RAG respects scope gates, ВКР / Long-Review Pipeline (map-reduce), Local instance setup steps (install, DB, run, test) (+3 more)

### Community 103 - "Root Package Config"
Cohesion: 0.12
Nodes (16): concurrently, devDependencies, concurrently, name, overrides, pdfjs-dist, private, scripts (+8 more)

### Community 104 - "Support Ops Docs"
Cohesion: 0.15
Nodes (17): GET /api/health, Post-Tuning Health Check, Known Issues Log, Support Operations Overview, Future Auto-Fix Agent (runbook-driven), npm run backup:db (Nightly Backup Script), GET /api/health (support monitoring target), production_incidents Table (migration 072) (+9 more)

### Community 105 - "Org Structure API"
Cohesion: 0.17
Nodes (16): bulkCreateOrgUnits(), createOrgUnit(), deleteOrgUnit(), DOMAIN_LABEL, getOrgStructure(), GrantDomain, InstitutionMember, moveOrgUnit() (+8 more)

### Community 106 - "Presentation Queries"
Cohesion: 0.21
Nodes (12): createPresentationJob(), getPresentationJobById(), createPresentation(), deletePresentation(), findPresentationById(), findPresentationsByTeacher(), setSlideImage(), toPresentation() (+4 more)

### Community 107 - "Deployment & Backup Docs"
Cohesion: 0.13
Nodes (12): Database backup strategy (pg_dump + disk snapshot), Yandex Cloud one-time console setup (SA, buckets, VM, DNS, SSL), Table B — function gates, LTI 1.3 integration (§6 in Research.md), Local SAML SSO testing flow (Keycloak stand-in IdP), Live QR quiz («Запустить в аудитории»), LTI 1.3 integration (launch, Deep Linking, AGS, NRPS, Dynamic Registration), Задания студентам (published assignments) — Pro 🚧 (+4 more)

### Community 108 - "Presentations API"
Cohesion: 0.17
Nodes (12): downloadPresentationPptx(), GenerateRequest, getPresentationJob(), ImageSearchResponse, PresentationJob, PresentationJobStatus, searchSlideImages(), setSlideImage() (+4 more)

### Community 109 - "Submission Queue & Market Evidence API"
Cohesion: 0.21
Nodes (14): actOnSubmission(), generateMarketEvidence(), getMarketEvidence(), getSubmissionQueue(), getSupportedRegions(), listPrograms(), updateMarketEvidence(), MultiSelect() (+6 more)

### Community 110 - "Public Student Write API"
Cohesion: 0.21
Nodes (10): acceptConsent(), getWriteState(), publicClient, saveDraft(), submitWrite(), WriteAssignment, WriteState, Composer() (+2 more)

### Community 111 - "Usage Counters Middleware"
Cohesion: 0.24
Nodes (8): getLimits(), getOrCreateCounter(), incrementUsage(), UsageCounter, checkLiveSessionMonthlyLimit(), checkMonthlyLimit(), checkResourceLimit(), RESOURCE_LABEL

### Community 112 - "Cohort Synthesis"
Cohesion: 0.23
Nodes (13): CohortSynthesisRow, getCohortSynthesis(), upsertCohortSynthesis(), CohortSubmissionRow, findApprovedCohortSubmissions(), buildScoreDistribution(), ChunkSummary, reduceSummaries() (+5 more)

### Community 113 - "Teacher & Notification Lookup"
Cohesion: 0.30
Nodes (13): listRoleHoldersForUnit(), getDisciplineNotificationInfo(), findTeacherById(), toTeacher(), getTransporter(), reputationHeaders(), sendEmail(), SendResult (+5 more)

### Community 114 - "Feature Spend Cap Cache"
Cohesion: 0.23
Nodes (11): cache, CacheEntry, cacheKey(), checkOne(), currentDaySpendForFeature(), featureCapEnvKey(), ENV_KEYS, saved (+3 more)

### Community 115 - "RPD Report Excel Export"
Cohesion: 0.22
Nodes (14): RpdOverview, RpdStatus, autoWidth(), generateRpdGroupWorkbook(), generateRpdMasterWorkbook(), HEADER_FILL, HEADER_FONT, pct() (+6 more)

### Community 116 - "Research Paper: Grading System"
Cohesion: 0.17
Nodes (15): Article: Adaptive Self-Evaluating AI Grading System for Russian-Language Academic Writing, Confidence Estimation via Ensemble Disagreement, Criteria-as-Atoms Model, Open Russian-Language Academic Grading Dataset, Failure Modes (flywheel bias, false confidence), fitThresholds (Calibrated Confidence Thresholds), Subject-Scoped Flywheel (chronology-aware retrieval), gradeOnce (shared prod/eval grading function) (+7 more)

### Community 117 - "BRS API"
Cohesion: 0.21
Nodes (11): addBrsManualEntry(), createBrsDraft(), extractBrsDraft(), publishBrsScheme(), BrsStudio(), emptyDraft, SchemeView(), BrsCheckpoint (+3 more)

### Community 118 - "Eval Runner"
Cohesion: 0.26
Nodes (11): arg(), main(), findEvalResults(), meanAbsoluteError(), pearson(), quadraticWeightedKappa(), ranks(), spearman() (+3 more)

### Community 119 - "Yandex Images Testing"
Cohesion: 0.27
Nodes (12): main(), apiKey(), between(), extractHost(), firstNonEmpty(), isStockHost(), num(), parseYandexImagesXml() (+4 more)

### Community 120 - "Course Queries"
Cohesion: 0.25
Nodes (11): CourseRow, createCourse(), deleteCourse(), findCourseByTeacherAndName(), findCoursesByTeacher(), toCourse(), updateCourse(), router (+3 more)

### Community 121 - "RAG Retrieval Metrics"
Cohesion: 0.27
Nodes (12): getCrossInstitutionUseCount(), getKafedraContribution30d(), recordRagRetrievals(), getLearningLoopSummary(), LearningLoopSummary, pctFromDelta(), queryBulletsRetention(), queryStyleMatch() (+4 more)

### Community 122 - "VM Tuning Ops"
Cohesion: 0.16
Nodes (14): VM Tuning Ops Checklist, PM2 Cluster Mode Migration (instances: 2), backend/src/db/connection.ts, ecosystem.config.js, Migration 016 (assignments indexes), pm2-logrotate Setup, Postgres Memory Tuning for 2GB RAM, 4GB VM Bump Recommendation (+6 more)

### Community 123 - "Admin Usage Dashboard"
Cohesion: 0.24
Nodes (11): getAdminOverview(), getDailyUsage(), getEditDistanceSummary(), getUsageByFeature(), getUsageByModel(), getUsageByTeacher(), AdminOverview(), AdminUsage() (+3 more)

### Community 124 - "Institution Contract Queries"
Cohesion: 0.24
Nodes (8): createInstitutionContract(), CreateInstitutionContractParams, deleteInstitutionContract(), getCurrentInstitutionContract(), InstitutionContract, makeContract(), listInstitutionContracts(), updateInstitutionContract()

### Community 125 - "Syllabus Author Service"
Cohesion: 0.26
Nodes (10): saveSyllabusStudioDraft(), router, DraftParams, draftSyllabus(), draftToText(), CompetencyInput, analyzeOverlapRules, syllabusDraftRules (+2 more)

### Community 126 - "Calc Answer Verifier"
Cohesion: 0.28
Nodes (10): ALLOWED_EXPRESSION_RE, ALLOWED_FUNCTIONS, buildStepVerdict(), evaluateExpression(), extractLeadingNumber(), math, numbersMatch(), RawCalcStep (+2 more)

### Community 127 - "FOS Coverage Check"
Cohesion: 0.33
Nodes (10): buildPassportRows(), checkCoverage(), collectQuizHaystack(), collectTaskHaystack(), collectTicketHaystack(), findBalanceWarning(), normalise(), stem() (+2 more)

### Community 128 - "Admin Capacity Page"
Cohesion: 0.24
Nodes (11): CapacityOverview, getCapacityOverview(), InstitutionSummaryRow, AdminCapacity(), fmtPct(), fmtUsd(), institutionLabel(), InvestorView() (+3 more)

### Community 129 - "Audit Log Queries"
Cohesion: 0.24
Nodes (10): AuditFilters, AuditRow, listAudit(), listAuditByInstitution(), recordAudit(), auditLog(), deriveAction(), isId() (+2 more)

### Community 130 - "LTI Line Item Queries"
Cohesion: 0.24
Nodes (10): getLtiConfig(), findLtiGradeSyncTarget(), LtiGradeSyncTarget, LtiLineItemRow, recordLineItemIfAbsent(), getServiceAccessToken(), tokenCacheKey(), fetchRoster() (+2 more)

### Community 131 - "Policy Memo Queries"
Cohesion: 0.33
Nodes (10): countApprovalsSince(), findPolicyMemoSources(), getPolicyMemo(), PolicyMemo, PolicyMemoRow, PolicyMemoSourceRow, toPolicyMemo(), upsertPolicyMemo() (+2 more)

### Community 132 - "Invite & Consent Queries"
Cohesion: 0.18
Nodes (10): createSnapshot(), getInviteByToken(), getInviteIdByToken(), markInviteSubmitted(), recordConsent(), saveDraft(), router, writableInvite() (+2 more)

### Community 133 - "RPD Snapshot Records"
Cohesion: 0.24
Nodes (11): RpdDeptGroupRecord, RpdSnapshotRecord, RpdSnapshotRowRecord, pctStatus(), STATUS_FILL_HEX, draftNarrative(), generateRpdReminderDocx(), generateRpdReminderText() (+3 more)

### Community 134 - "Cohort Analytics"
Cohesion: 0.24
Nodes (9): average(), CohortAnalytics, CohortRow, computeCohortAnalytics(), GroupBreakdown, MissedCriterion, normaliseName(), SlippingStudent (+1 more)

### Community 135 - "Program Report PDF"
Cohesion: 0.20
Nodes (11): C, FONT_DIR, FONTS, gapColumns(), generateProgramReportPdf(), LEVEL_FILL, LEVEL_LABEL, scoreColor() (+3 more)

### Community 136 - "152-ФЗ Legal Docs"
Cohesion: 0.26
Nodes (12): 152-ФЗ DPA Template, 152-ФЗ (Federal Law on Personal Data), Cross-Border Transfer to DeepSeek, РФ Data Residency Requirement (ч.5 ст.18 152-ФЗ), Subprocessor List (Yandex Cloud, Unisender Go, DeepSeek), YandexGPT RF-Hosted Alternative (avoids cross-border transfer), ИСПУМ Security & Data Processing Overview, Yandex Cloud RF Data Residency (+4 more)

### Community 137 - "Grading Feature Docs"
Cohesion: 0.18
Nodes (12): DeepSeek V3 (generative grading model), Verifiable Feedback / Citation Attribution, Grading Feature Support Doc, AI_SERVICE_ERROR, services/grading.ts gradeOnce, POST /api/grading, SPEND_CAP_EXCEEDED, validateCitation() (+4 more)

### Community 138 - "Program Document Queries"
Cohesion: 0.25
Nodes (10): deletePracticeForType(), deleteProgramDocument(), findProgramDocument(), findWorkingProgrammeForDiscipline(), insertProgramDocument(), listProgramDocuments(), listWorkingProgrammeVersions(), ProgramDocumentRow (+2 more)

### Community 139 - "Program Access Middleware"
Cohesion: 0.27
Nodes (9): Express, Request, requireProgramAccess(), assertEdit(), canEditProgram(), getProgramAccessScope(), ProgramAccessScope, programUnitsUnder() (+1 more)

### Community 140 - "Usage Ledger Feature Notes"
Cohesion: 0.27
Nodes (10): backend/src/services/capacityModel.ts, backend/src/services/featureSpendCap.ts, backend/src/services/providerCeilings.ts, backend/src/services/usageRollup.ts, Feature AL Phase 0 — true usage ledger (variant/account columns, institution_contracts), Feature AL Phase 1 — usage_rollup_monthly / institution_rollup_monthly, Feature AL Phase 2 — AdminCapacity page + headroom model, Feature AL Phase 3 — peak-to-mean ratio + provider ceilings (+2 more)

### Community 141 - "RPD Approval Workflow Docs"
Cohesion: 0.18
Nodes (10): backend/src/services/rpdSubmissionState.ts, backend/src/services/rpdSubmissions.ts, Rule 5: Approval history is append-only, РПД approval route (§7, delegates to RPD-WORKFLOW.md), rpd_submissions / rpd_submission_events / umc_published_reports schema, program_disciplines.responsible_teacher_id, РПД submission state machine (draft→submitted→returned→forwarded→approved), БРС engine (балльно-рейтинговая система) (+2 more)

### Community 142 - "Long Review Feature Docs"
Cohesion: 0.20
Nodes (9): Long Review (ВКР Map-Reduce) Support Doc, analyzeDrawing(), findInconsistencies() (Tier-2), findPremiseIssues() (Tier-5), POST /api/grading/review, services/longReview.ts, services/longReviewWorker.ts (pg-boss), Runbook: long-review-stuck (+1 more)

### Community 143 - "Database Backup Script"
Cohesion: 0.33
Nodes (8): backupBucketClient(), main(), runPgDump(), getStalledTeachers(), sendTelegramMessage(), sendActivationDigest(), startActivationDigestScheduler(), WeekStats

### Community 144 - "Object Storage Service"
Cohesion: 0.33
Nodes (8): FetchedFile, deleteObject(), downloadObject(), LOCAL_DIR, s3(), uploadObject(), documentStoragePath(), sanitiseName()

### Community 145 - "DeepSeek Provider Tests"
Cohesion: 0.20
Nodes (4): ENV_KEYS, { postMock, createUsageLogMock, sendTelegramAlertMock }, savedEnv, TruncatedResponseError

### Community 146 - "RAG Flywheel & Scaling Docs"
Cohesion: 0.20
Nodes (9): backend/src/services/rpdNotifications.ts, RAG Flywheel, rpdNotifications.ts — 3-email dispatcher, Tier 1 fixes (pool max=25, migration 016, PM2 cluster), Tier 2: fire-and-forget emails have no retry (outbox pattern), Tier 2: pgvector ivfflat lists=100 reindex trigger, Tier 2: rate-limit store in-process → Redis, Tier 3: move Postgres to Yandex Managed PostgreSQL (+1 more)

### Community 147 - "Word Extractor Types"
Cohesion: 0.20
Nodes (3): word-extractor, WordDocument, WordExtractor

### Community 148 - "Email Templates & AI Governance Rule"
Cohesion: 0.20
Nodes (5): Rule 3: AI never final, Table A — role bundle catalogue, Учебный план и РПД — суите 🚧 (Дублирование тем, Соответствие РПД, РПД-студия), Структура (org-structure tree builder) 🚧, 2.2 Curriculum coverage audit

### Community 149 - "Frontend Package Config"
Cohesion: 0.20
Nodes (9): name, private, scripts, build, dev, preview, test, test:watch (+1 more)

### Community 150 - "Slide HTML Rendering"
Cohesion: 0.49
Nodes (9): escapeAttr(), escapeHtml(), legacySlidesToHtml(), renderLegacy(), renderTyped(), richText(), slidesToHtml(), ul() (+1 more)

### Community 151 - "LTI Course Link Queries"
Cohesion: 0.28
Nodes (8): findLtiCourseLink(), findLtiCourseLinkByCourseId(), listLtiCourseLinksForInstitution(), LtiCourseLinkRow, LtiCourseLinkWithNames, recordNrpsMembershipsUrl(), resolveCourseForLtiLaunch(), setLtiCourseLinkOrgUnit()

### Community 152 - "Feedback Challenge UI Screenshot"
Cohesion: 0.31
Nodes (9): 'Что улучшить' (What to Improve) Feedback List UI, Convergence Criteria Specificity Recommendation, Feedback Item Criteria Mapping (к критерию dropdown), AI-Generated Clarifying Question per Feedback Item, Hallucination/Grounding Check on Validation-Plan Claim, PRESTO! Pressure Scheme Justification Challenge, Retracted Feedback Item ('Отозвано') with Justification, Model Validation Plan Request (retracted) (+1 more)

### Community 153 - "Admin Audit Page"
Cohesion: 0.31
Nodes (8): AuditEntry, getAudit(), AdminAudit(), AUTH_LABEL, describe(), fmt(), RESOURCE_LABEL, VERB_LABEL

### Community 154 - "Admin Payments Page"
Cohesion: 0.36
Nodes (8): getAdminPayments(), getPaymentsSummary(), AdminPayments(), fmtDateTime(), fmtMonth(), PLAN_LABEL, rub(), STATUS_LABEL

### Community 155 - "Math (KaTeX) Rendering"
Cohesion: 0.33
Nodes (8): BlockMath(), BlockProps, escapeHtml(), InlineProps, InlineText(), parseMixed(), renderSafe(), Segment

### Community 156 - "Draft Encryption"
Cohesion: 0.42
Nodes (7): getDraftKeySeed(), b64ToBuf(), bufToB64(), decryptFromStorage(), deriveKey(), encryptForStorage(), getKey()

### Community 157 - "TipTap Text Extraction"
Cohesion: 0.39
Nodes (5): BLOCK_TYPES, ProseMirrorNode, doc(), tiptapCharCount(), tiptapToText()

### Community 159 - "Admin Activation Funnel Page"
Cohesion: 0.43
Nodes (7): getActivationFunnel(), getStalledTeachers(), AdminActivation(), fmtDate(), fmtHours(), pct(), Tab

### Community 160 - "Frontend Deploy Upload Script"
Cohesion: 0.39
Nodes (7): CONTENT_TYPES, main(), NO_CACHE, putWithRetry(), s3, sleep(), walk()

### Community 161 - "Document Review Queries"
Cohesion: 0.48
Nodes (6): getLatestReviewByDiscipline(), getLatestReviewForDiscipline(), insertReview(), ReviewRow, toReview(), DisciplineCoverageResult

### Community 162 - "Placement Review Queries"
Cohesion: 0.48
Nodes (6): getLatestPlacementReviewForDiscipline(), getLatestPlacementReviewsByProgram(), insertPlacementReview(), PlacementReviewRow, toReview(), PlacementReviewResult

### Community 163 - "Backend Package Overrides"
Cohesion: 0.33
Nodes (5): name, overrides, pdfjs-dist, private, version

### Community 164 - "MTO Review Queries"
Cohesion: 0.53
Nodes (5): getLatestMtoReviewsByProgram(), insertMtoReview(), MtoReviewRow, toReview(), MtoReviewResult

### Community 165 - "Test Transaction Isolation"
Cohesion: 0.47
Nodes (5): ConnectCallback, installTransactionalTestIsolation(), rewrite(), savepointStack, wrapClientForSavepoints()

### Community 166 - "Provenance Computation"
Cohesion: 0.53
Nodes (3): computeProvenance(), round1(), SubmissionTelemetry

### Community 167 - "Grading Critique Form Screenshot"
Cohesion: 0.53
Nodes (6): Challenge-2 Grading Critique Form (UI screenshot), Cited source quote backing a critique point, Numerical convergence criteria recommendation (residual/pressure tolerance), Feedback item tagged to grading criterion (к критерию dropdown), Dispute AI feedback item flow (Оспорить), PRESTO! numerical scheme critique (CFD pressure discretization)

### Community 168 - "Admin Contact Messages Page"
Cohesion: 0.53
Nodes (5): getContactMessages(), markContactMessageRead(), AdminMessages(), fmt(), TOPIC

### Community 169 - "Org Member Roles API"
Cohesion: 0.33
Nodes (6): getMembers(), grantRole(), revokeRole(), setPrimaryUnit(), MembersSection(), plural()

### Community 170 - "Org Tree Types"
Cohesion: 0.40
Nodes (5): OrgUnit, OrgUnitType, ShareTarget, TreeNode, TYPE_LABEL

### Community 171 - "Service Worker Update Toast"
Cohesion: 0.60
Nodes (3): NewVersionToast(), isUpdateStale(), SW_UPDATE_GRACE_MS

### Community 173 - "DB Migration Script"
Cohesion: 0.40
Nodes (3): fs, path, { Pool }

### Community 174 - "Program Document Diffs"
Cohesion: 0.60
Nodes (4): DiffRow, findDiff(), insertDiff(), toDiff()

### Community 175 - "AI Feedback Panel Screenshot"
Cohesion: 0.60
Nodes (5): Challenge/Dispute AI Feedback Feature (Оспорить), Quoted Source Excerpt Under Each Suggestion, Rubric Criteria Tagging (Аргументация, Глубина анализа), Generated Socratic Follow-up Question with Copy Button, "What to Improve" AI Feedback Panel Screenshot

### Community 176 - "Load Test Dashboard (k6)"
Cohesion: 0.50
Nodes (3): options, tokens, VUS_TARGET

### Community 177 - "KaTeX Type Shim"
Cohesion: 0.50
Nodes (3): katex, katex/dist/katex.min.css, KatexOptions

## Ambiguous Edges - Review These
- `services/grading.ts` → `Feature AL Phase 0 — true usage ledger (variant/account columns, institution_contracts)`  [AMBIGUOUS]
  CHANGELOG.md · relation: conceptually_related_to
- `docs/rop-pilot-onboarding.md` → `docs/rop-pilot-test-script.pdf`  [AMBIGUOUS]
  docs/rop-pilot-onboarding.md · relation: conceptually_related_to

## Knowledge Gaps
- **930 isolated node(s):** `name`, `version`, `private`, `dev`, `build` (+925 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **32 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `services/grading.ts` and `Feature AL Phase 0 — true usage ledger (variant/account columns, institution_contracts)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `docs/rop-pilot-onboarding.md` and `docs/rop-pilot-test-script.pdf`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `pool` connect `DB Connection & Test Cleanup` to `Audit Log Queries`, `Shared Domain Types`, `LTI Line Item Queries`, `Policy Memo Queries`, `Live Sessions & RAG Chunks`, `Assignments Service`, `Program Document Queries`, `App Routes & Tasks`, `Program Access Middleware`, `Database Backup Script`, `Pricing & Payments`, `Org Unit Queries`, `LTI Deep Linking`, `Long Review (ВКР) Service`, `Document Chunking`, `Institution Queries`, `LTI Course Link Queries`, `Assignment Approval`, `Load Test Seeding & Org Units`, `Program Queries`, `Leadership Queries`, `Document Review Queries`, `Placement Review Queries`, `Teacher Queries`, `File Upload Validation`, `MTO Review Queries`, `Program Topology Queries`, `Unit Economics`, `FGOS Standard Queries`, `RPD Submission Queries`, `Marketing Export & Password Reset`, `Feature Spend Cap`, `Program Document Diffs`, `Confidence Config`, `Rubric Queries`, `Confidence Eval Script`, `Document & Syllabus Chunks`, `RPD Dept Mapping Fix Script`, `Published Assignment Queries`, `Institution Strategy Docs`, `Program Market Evidence`, `Usage Logging`, `Citation Checker & Topics`, `UMC Dashboard`, `Embeddings Backfill`, `Contact Messages Queries`, `Criteria Queries`, `FOS Documents & Tasks`, `Eval Runs & Confidence`, `BRS Queries`, `FOS Documents Service`, `Provider Rate Ceilings`, `Activation Funnel Queries`, `Capacity & Resource Monitoring`, `Score Calibration Queries`, `Incident Logging & Alerts`, `Grade Jobs`, `Presentation Jobs`, `Presentation Queries`, `Usage Counters Middleware`, `Cohort Synthesis`, `Feature Spend Cap Cache`, `Eval Runner`, `Course Queries`, `RAG Retrieval Metrics`, `Institution Contract Queries`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **Why does `logger` connect `Incident Logging & Alerts` to `Audit Log Queries`, `LTI Line Item Queries`, `Policy Memo Queries`, `Live Sessions & RAG Chunks`, `Assignments Service`, `FGOS Competency Linking`, `Database Backup Script`, `Object Storage Service`, `Pricing & Payments`, `RAG Assignment Matching`, `LTI Deep Linking`, `Long Review (ВКР) Service`, `Document Chunking`, `LLM Cost & Criteria Assist`, `Assignment Approval`, `Plan Limits & Yandex Cost`, `Program Queries`, `Teacher Queries`, `DB Connection & Test Cleanup`, `File Upload Validation`, `FGOS Standard Queries`, `RPD Submission Queries`, `Feature Spend Cap`, `Confidence Config`, `Document & Syllabus Chunks`, `Presentation Export (PPTX)`, `Institution Strategy Docs`, `Program Market Evidence`, `Usage Logging`, `Citation Checker & Topics`, `Embeddings Backfill`, `FOS Documents & Tasks`, `Eval Runs & Confidence`, `FOS Documents Service`, `Usage Rollup Backfill`, `Presentation Eval Harness`, `Activation Funnel Queries`, `SAML Verification`, `Capacity & Resource Monitoring`, `Curriculum Analysis Service`, `Job Queue (pg-boss)`, `Grade Jobs`, `Presentation Jobs`, `Teacher & Notification Lookup`, `Feature Spend Cap Cache`, `Yandex Images Testing`, `Syllabus Author Service`, `Calc Answer Verifier`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `dependencies` connect `Backend Dependencies (Storage)` to `pg Driver Dependency`, `Job Queue (pg-boss)`, `Backend Package Overrides`, `Cookie Parser Dependency`, `docx Dependency`, `Express Dependency`, `Rate Limit Dependency`, `Mammoth (docx parsing) Dependency`, `Nodemailer Dependency`, `pdf-parse Dependency`, `PDFKit Dependency`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _930 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Program Review & Placement` be split into smaller, more focused modules?**
  _Cohesion score 0.024853801169590642 - nodes in this community are weakly interconnected._