import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SaverModeSource } from '../contexts/SaverModeContext';
import { useAppTheme } from '../theme/useAppTheme';
import { useTranslation } from '../i18n/useTranslation';

interface Props {
  visible: boolean;
  source: SaverModeSource;
}

/**
 * Banner shown at the top of screens when Saver Mode is active.
 * Explains *why* certain features are reduced so the user understands
 * the degraded behaviour.
 */
export const SaverModeBanner: React.FC<Props> = ({ visible, source }) => {
  const { colors } = useAppTheme();
  const { t } = useTranslation();

  if (!visible) return null;

  const reason =
    source === 'auto'
      ? t('saverBanner.reasonAuto')
      : t('saverBanner.reasonManual');

  return (
    <View
      style={[styles.banner, { backgroundColor: colors.infoBg, borderBottomColor: colors.info }]}
      accessible
      accessibilityRole="alert"
      accessibilityLabel={t('saverBanner.accessible', { reason })}
    >
      <Text style={styles.icon} accessibilityElementsHidden>
        &#x1F4A1;
      </Text>
      <View style={styles.textContainer}>
        <Text style={[styles.title, { color: colors.info }]} maxFontSizeMultiplier={2}>{t('saverBanner.saverMode')}</Text>
        <Text style={[styles.subtitle, { color: colors.info }]} maxFontSizeMultiplier={2}>
          {reason}. {t('saverBanner.subtitle')}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  icon: {
    fontSize: 16,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 12,
    marginTop: 2,
    opacity: 0.9,
  },
});
