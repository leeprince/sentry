import * as React from 'react';
import styled from '@emotion/styled';

import Checkbox from 'sentry/components/checkbox';
import FeatureBadge from 'sentry/components/featureBadge';
import Tooltip from 'sentry/components/tooltip';
import {t} from 'sentry/locale';
import {Organization} from 'sentry/types';
import withOrganization from 'sentry/utils/withOrganization';
import {
  DESCRIPTIONS,
  EVENT_CHOICES,
} from 'sentry/views/settings/organizationDeveloperSettings/constants';

type Resource = typeof EVENT_CHOICES[number];

type DefaultProps = {
  webhookDisabled: boolean;
};

type Props = DefaultProps & {
  checked: boolean;
  disabledFromPermissions: boolean;
  isNew: boolean;
  onChange: (resource: Resource, checked: boolean) => void;
  organization: Organization;
  resource: Resource;
};

export class SubscriptionBox extends React.Component<Props> {
  static defaultProps: DefaultProps = {
    webhookDisabled: false,
  };

  onChange = (evt: React.ChangeEvent<HTMLInputElement>) => {
    const checked = evt.target.checked;
    const {resource} = this.props;
    this.props.onChange(resource, checked);
  };

  render() {
    const {resource, organization, webhookDisabled, checked, isNew} = this.props;
    const features = new Set(organization.features);

    let disabled = this.props.disabledFromPermissions || webhookDisabled;
    let message = `Must have at least 'Read' permissions enabled for ${resource}`;
    if (resource === 'error' && !features.has('integrations-event-hooks')) {
      disabled = true;
      message =
        'Your organization does not have access to the error subscription resource.';
    }
    if (webhookDisabled) {
      message = 'Cannot enable webhook subscription without specifying a webhook url';
    }

    return (
      <React.Fragment>
        <SubscriptionGridItemWrapper key={resource}>
          <Tooltip disabled={!disabled} title={message}>
            <SubscriptionGridItem disabled={disabled}>
              <SubscriptionInfo>
                <SubscriptionTitle>
                  {t(`${resource}`)}
                  {isNew && <FeatureBadge type="new" />}
                </SubscriptionTitle>
                <SubscriptionDescription>
                  {t(`${DESCRIPTIONS[resource]}`)}
                </SubscriptionDescription>
              </SubscriptionInfo>
              <Checkbox
                key={`${resource}${checked}`}
                disabled={disabled}
                id={resource}
                value={resource}
                checked={checked}
                onChange={this.onChange}
              />
            </SubscriptionGridItem>
          </Tooltip>
        </SubscriptionGridItemWrapper>
      </React.Fragment>
    );
  }
}

export default withOrganization(SubscriptionBox);

const SubscriptionInfo = styled('div')`
  display: flex;
  flex-direction: column;
`;

const SubscriptionGridItem = styled('div')<{disabled: boolean}>`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  background: ${p => p.theme.backgroundSecondary};
  opacity: ${({disabled}: {disabled: boolean}) => (disabled ? 0.3 : 1)};
  border-radius: 3px;
  flex: 1;
  padding: 12px;
  height: 100%;
`;

const SubscriptionGridItemWrapper = styled('div')`
  padding: 12px;
  width: 33%;
`;

const SubscriptionDescription = styled('div')`
  font-size: 12px;
  line-height: 1;
  color: ${p => p.theme.gray300};
  white-space: nowrap;
`;

const SubscriptionTitle = styled('div')`
  font-size: 16px;
  line-height: 1;
  color: ${p => p.theme.textColor};
  white-space: nowrap;
  margin-bottom: 5px;
`;
