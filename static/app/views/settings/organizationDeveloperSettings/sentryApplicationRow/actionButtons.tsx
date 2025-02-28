import styled from '@emotion/styled';

import Button from 'sentry/components/button';
import ConfirmDelete from 'sentry/components/confirmDelete';
import {IconDelete, IconStats, IconUpgrade} from 'sentry/icons';
import {t} from 'sentry/locale';
import space from 'sentry/styles/space';
import {Organization, SentryApp} from 'sentry/types';

type Props = {
  app: SentryApp;
  onDelete: (app: SentryApp) => void;

  org: Organization;
  showDelete: boolean;
  showPublish: boolean;
  disableDeleteReason?: string;
  // If you want to disable the publish or delete buttons, pass in a reason to display to the user in a tooltip
  disablePublishReason?: string;
  onPublish?: () => void;
};

const ActionButtons = ({
  org,
  app,
  showPublish,
  showDelete,
  onPublish,
  onDelete,
  disablePublishReason,
  disableDeleteReason,
}: Props) => {
  const appDashboardButton = (
    <StyledButton
      size="small"
      icon={<IconStats />}
      to={`/settings/${org.slug}/developer-settings/${app.slug}/dashboard/`}
    >
      {t('Dashboard')}
    </StyledButton>
  );

  const publishRequestButton = showPublish ? (
    <StyledButton
      disabled={!!disablePublishReason}
      title={disablePublishReason}
      icon={<IconUpgrade />}
      size="small"
      onClick={onPublish}
    >
      {t('Publish')}
    </StyledButton>
  ) : null;

  const deleteConfirmMessage = t(
    `Deleting ${app.slug} will also delete any and all of its installations. \
         This is a permanent action. Do you wish to continue?`
  );
  const deleteButton = showDelete ? (
    disableDeleteReason ? (
      <StyledButton
        disabled
        title={disableDeleteReason}
        size="small"
        icon={<IconDelete />}
        aria-label="Delete"
      />
    ) : (
      onDelete && (
        <ConfirmDelete
          message={deleteConfirmMessage}
          confirmInput={app.slug}
          priority="danger"
          onConfirm={() => onDelete(app)}
        >
          <StyledButton size="small" icon={<IconDelete />} aria-label="Delete" />
        </ConfirmDelete>
      )
    )
  ) : null;

  return (
    <ButtonHolder>
      {appDashboardButton}
      {publishRequestButton}
      {deleteButton}
    </ButtonHolder>
  );
};

const ButtonHolder = styled('div')`
  flex-direction: row;
  display: flex;
  & > * {
    margin-left: ${space(0.5)};
  }
`;

const StyledButton = styled(Button)`
  color: ${p => p.theme.subText};
`;

export default ActionButtons;
