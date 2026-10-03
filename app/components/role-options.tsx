import { useTranslation } from "react-i18next";
import { BUILTIN_ROLES } from "~/lib/api-types";

export interface CustomRoleRow {
  id: string;
  name: string;
  description?: string;
  basedOn?: string;
  permissions?: string[];
  assignedUsers?: number;
  version?: number;
  updatedAt?: string;
}

/** 역할 선택지: 기본 5종 + 사용자 정의 역할 */
export function RoleOptions({ customRoles }: { customRoles: CustomRoleRow[] }) {
  const { t } = useTranslation();
  return (
    <>
      {BUILTIN_ROLES.map((role) => (
        <option key={role} value={role}>
          {t(`roles.${role}`)}
        </option>
      ))}
      {customRoles.map((role) => (
        <option key={role.id} value={`CUSTOM:${role.id}`}>
          {role.name}
        </option>
      ))}
    </>
  );
}
