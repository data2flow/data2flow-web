/**
 * M2 core 가짜 핸들러 목록. 앞에서부터 처리하고 undefined를 돌려주면 다음 핸들러로 넘긴다.
 * 도메인마다 파일 하나: 소스(DSC)·기기/모델/측정 항목/그룹(DEV)·공간(DEV-01, DSH-02)·시계열(TSD)·수집(ING, DSH-03)·스크립트(SCR)·홈(DSH-01),
 * M5: 기기·모델 데이터 관리(devmodel: 검색식·저장된 검색·모델 가져오기/내보내기·표준 내보내기·게이트웨이·단위)
 * M5: 현장 작업(작업 지시·자산·QR·설치, field — 기기 경로보다 먼저),
 * M3: 플로우(FLW)·가상 환경(SIM)·제어(ACT), M4: 규칙·알람(RUL)·알림·운영(OPS-05·06)·자동화 부가 화면(FLW-04·11)
 * M5 floor: 층·IFC 모델(DSH-12.04)·조직 달력(DEV-12.01)·운영 모드 수동 지정·외부 맥락(DSC-06)
 * M5 data: 내보내기·가져오기·보관·사전(TSD-04·05·07)·저장 지표(OPS-01.03)
 */
import type { CoreHandler } from "../core-fixtures";
import { baseHandler } from "./base";
import { controlHandler } from "./control";
import { dataHandler } from "./data";
import { fieldHandler } from "./field";
import { dashboardsHandler, dashboardsPublicHandler } from "./dashboards";
import { flowopsHandler } from "./flowops";
import { floorHandler } from "./floor";
import { flowsHandler } from "./flows";
import { notifyHandler } from "./notify";
import { rulesHandler } from "./rules";
import { simHandler } from "./sim";
import { devicesHandler } from "./devices";
import { devModelHandler } from "./devmodel";
import { groupsHandler } from "./groups";
import { modelsHandler } from "./models";
import { homeHandler } from "./home";
import { ingestHandler } from "./ingest";
import { scriptsHandler } from "./scripts";
import { scriptsM5Handler } from "./scripts-m5";
import { sourcesHandler } from "./sources";
import { spacesHandler } from "./spaces";
import { telemetryHandler } from "./telemetry";

// M5 scripts: scriptsM5Handler는 /scripts·/ingest 핸들러보다 먼저 M5 경로를 받는다
export const CORE_HANDLERS: CoreHandler[] = [dashboardsHandler, scriptsM5Handler, fieldHandler, devModelHandler, dataHandler, floorHandler, rulesHandler, notifyHandler, flowopsHandler, flowsHandler, simHandler, controlHandler, spacesHandler, devicesHandler, modelsHandler, groupsHandler, sourcesHandler, telemetryHandler, ingestHandler, scriptsHandler, homeHandler, baseHandler];

/** 공개 경로(로그인 없음, `/public/**`) 핸들러. M5: 공유 링크 보기·브랜딩(API-DSH-15·25) */
export const PUBLIC_HANDLERS = [dashboardsPublicHandler];
