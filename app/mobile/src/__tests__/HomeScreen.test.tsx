import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { HomeScreen } from '../screens/HomeScreen';

describe('HomeScreen', () => {
  const mockNavigation = {
    navigate: jest.fn(),
  } as any;

  it('renders correctly', () => {
    const { getByText } = render(<HomeScreen navigation={mockNavigation} />);
    expect(getByText('Soter Mobile')).toBeTruthy();
    expect(getByText('Transparent aid, directly delivered.')).toBeTruthy();
  });

  it('navigates to Health Screen when button is pressed', () => {
    const { getByText } = render(<HomeScreen navigation={mockNavigation} />);
    const button = getByText('Check Backend Health');
    
    fireEvent.press(button);
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Health');
  });
});
