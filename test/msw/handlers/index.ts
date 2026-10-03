/**
 * M2 core 가짜 핸들러 목록. 앞에서부터 처리하고 undefined를 돌려주면 다음 핸들러로 넘긴다.
 * 도메인마다 파일 하나: 소스(DSC)·기기/모델/측정 항목/그룹(DEV)·공간(DEV-01, DSH-02)·시계열(TSD)·수집(ING, DSH-03)·스크립트(SCR)·홈(DSH-01)
 */
import type { CoreHandler } from "../core-fixtures";
import { baseHandler } from "./base";
import { devicesHandler } from "./devices";
import { groupsHandler } from "./groups";
import { modelsHandler } from "./models";
import { homeHandler } from "./home";
import { ingestHandler } from "./ingest";
import { scriptsHandler } from "./scripts";
import { sourcesHandler } from "./sources";
import { spacesHandler } from "./spaces";
import { telemetryHandler } from "./telemetry";

export const CORE_HANDLERS: CoreHandler[] = [spacesHandler, devicesHandler, modelsHandler, groupsHandler, sourcesHandler, telemetryHandler, ingestHandler, scriptsHandler, homeHandler, baseHandler];
