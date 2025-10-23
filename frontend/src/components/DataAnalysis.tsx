import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  VStack,
  HStack,
  Text,
  Badge,
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
  Progress,
  Card,
  CardHeader,
  CardBody,
  Heading,
  Divider,
  List,
  ListItem,
  ListIcon,
  Stat,
  StatLabel,
  StatNumber,
  StatHelpText,
  Accordion,
  AccordionItem,
  AccordionButton,
  AccordionPanel,
  AccordionIcon,
  Spinner,
  Flex,
  Icon,
  Tooltip,
  SimpleGrid,
} from '@chakra-ui/react';
import {
  CheckCircleIcon,
  WarningIcon,
  InfoIcon,
  EmailIcon,
  PhoneIcon,
  CalendarIcon,
  AttachmentIcon,
} from '@chakra-ui/icons';

interface DataAnalysisProps {
  importId: string;
  backendUrl: string;
  onAnalysisComplete?: (analysis: any) => void;
}

interface ColumnAnalysis {
  inferred_type: string;
  type_confidence: number;
  description: string;
  quality_score: number;
  quality_details: string;
  format_detection: string;
  empty_percentage: number;
  total_rows: number;
  valid_rows: number;
  sample_values: string[];
  recommendations: string[];
}

interface AnalysisResult {
  header_detection: {
    detected_header_row: number;
    confidence: number;
    suggestion: string;
  };
  column_analysis: Record<string, ColumnAnalysis>;
  overall_quality: {
    score: number;
    description: string;
  };
  recommendations: string[];
}

const getDataTypeIcon = (dataType: string) => {
  switch (dataType) {
    case 'email':
      return EmailIcon;
    case 'phone':
      return PhoneIcon;
    case 'date':
      return CalendarIcon;
    case 'number':
    case 'currency':
      return AttachmentIcon;
    default:
      return InfoIcon;
  }
};

const getDataTypeColor = (dataType: string) => {
  switch (dataType) {
    case 'email':
      return 'blue';
    case 'phone':
      return 'green';
    case 'date':
      return 'purple';
    case 'number':
      return 'orange';
    case 'currency':
      return 'teal';
    case 'boolean':
      return 'cyan';
    case 'url':
      return 'red';
    default:
      return 'gray';
  }
};

const getQualityColor = (score: number) => {
  if (score >= 90) return 'green';
  if (score >= 75) return 'yellow';
  if (score >= 50) return 'orange';
  return 'red';
};

export default function DataAnalysis({ importId, backendUrl, onAnalysisComplete }: DataAnalysisProps) {
  const { t } = useTranslation();
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (importId) {
      performAnalysis();
    }
  }, [importId]);

  const performAnalysis = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${backendUrl}/apis/v1/imports/${importId}/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Analysis failed: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (result.success) {
        setAnalysis(result.analysis);
        onAnalysisComplete?.(result.analysis);
      } else {
        throw new Error('Analysis was not successful');
      }
    } catch (err) {
      console.error('Analysis error:', err);
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardBody>
          <VStack spacing={4}>
            <Spinner size="lg" color="blue.500" />
            <Text>Analyzing your data...</Text>
            <Text fontSize="sm" color="gray.600">
              Performing automatic header detection, data type inference, and quality analysis
            </Text>
          </VStack>
        </CardBody>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert status="error">
        <AlertIcon />
        <AlertTitle>Analysis Failed</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!analysis) {
    return null;
  }

  const { header_detection, column_analysis, overall_quality, recommendations } = analysis;

  return (
    <VStack spacing={6} align="stretch">
      {/* Header Detection */}
      <Card>
        <CardHeader>
          <Heading size="md">📋 Header Detection</Heading>
        </CardHeader>
        <CardBody>
          <HStack justify="space-between">
            <VStack align="start" spacing={1}>
              <Text fontWeight="semibold">{header_detection.suggestion}</Text>
              <Text fontSize="sm" color="gray.600">
                Confidence: {header_detection.confidence}%
              </Text>
            </VStack>
            <Badge
              colorScheme={header_detection.confidence > 80 ? 'green' : header_detection.confidence > 50 ? 'yellow' : 'red'}
              variant="solid"
            >
              {header_detection.confidence > 80 ? 'High Confidence' : header_detection.confidence > 50 ? 'Medium Confidence' : 'Low Confidence'}
            </Badge>
          </HStack>
        </CardBody>
      </Card>

      {/* Overall Quality Score */}
      <Card>
        <CardHeader>
          <Heading size="md">🎯 Overall Data Quality</Heading>
        </CardHeader>
        <CardBody>
          <VStack align="stretch" spacing={4}>
            <Flex align="center" justify="space-between">
              <VStack align="start" spacing={1}>
                <Text fontSize="xl" fontWeight="bold" color={`${getQualityColor(overall_quality.score)}.500`}>
                  {overall_quality.score}% Quality Score
                </Text>
                <Text color="gray.600">{overall_quality.description}</Text>
              </VStack>
              <Progress
                value={overall_quality.score}
                size="lg"
                colorScheme={getQualityColor(overall_quality.score)}
                width="200px"
              />
            </Flex>
            
            {recommendations.length > 0 && (
              <>
                <Divider />
                <Box>
                  <Text fontWeight="semibold" mb={2}>💡 Recommendations:</Text>
                  <List spacing={1}>
                    {recommendations.map((rec, index) => (
                      <ListItem key={index} fontSize="sm">
                        <ListIcon as={InfoIcon} color="blue.500" />
                        {rec}
                      </ListItem>
                    ))}
                  </List>
                </Box>
              </>
            )}
          </VStack>
        </CardBody>
      </Card>

      {/* Column Analysis */}
      <Card>
        <CardHeader>
          <Heading size="md">📊 Column Analysis</Heading>
          <Text fontSize="sm" color="gray.600" mt={1}>
            Detailed analysis of each column including data type inference and quality scores
          </Text>
        </CardHeader>
        <CardBody>
          <Accordion allowMultiple>
            {Object.entries(column_analysis).map(([columnName, analysis]) => {
              const DataTypeIcon = getDataTypeIcon(analysis.inferred_type);
              const typeColor = getDataTypeColor(analysis.inferred_type);
              const qualityColor = getQualityColor(analysis.quality_score);

              return (
                <AccordionItem key={columnName}>
                  <AccordionButton>
                    <Box flex="1" textAlign="left">
                      <HStack justify="space-between" width="100%">
                        <HStack>
                          <Icon as={DataTypeIcon} color={`${typeColor}.500`} />
                          <Text fontWeight="semibold">{columnName}</Text>
                          <Badge colorScheme={typeColor} variant="subtle">
                            {analysis.inferred_type}
                          </Badge>
                        </HStack>
                        <HStack>
                          <Badge colorScheme={qualityColor} variant="solid">
                            {analysis.quality_score}% Quality
                          </Badge>
                          {analysis.empty_percentage > 20 && (
                            <Badge colorScheme="orange" variant="outline">
                              {analysis.empty_percentage}% Empty
                            </Badge>
                          )}
                        </HStack>
                      </HStack>
                    </Box>
                    <AccordionIcon />
                  </AccordionButton>
                  <AccordionPanel pb={4}>
                    <VStack align="stretch" spacing={4}>
                      {/* Type Information */}
                      <Box>
                        <Text fontSize="sm" fontWeight="semibold" mb={2}>🔍 Type Detection:</Text>
                        <VStack align="start" spacing={1}>
                          <Text fontSize="sm">
                            <strong>{analysis.description}</strong> (Confidence: {analysis.type_confidence}%)
                          </Text>
                          <Text fontSize="sm" color="gray.600">
                            {analysis.format_detection}
                          </Text>
                        </VStack>
                      </Box>

                      {/* Quality Information */}
                      <Box>
                        <Text fontSize="sm" fontWeight="semibold" mb={2}>📈 Quality Analysis:</Text>
                        <SimpleGrid columns={2} spacing={4}>
                          <Stat size="sm">
                            <StatLabel>Quality Score</StatLabel>
                            <StatNumber color={`${qualityColor}.500`}>
                              {analysis.quality_score}%
                            </StatNumber>
                            <StatHelpText>{analysis.quality_details}</StatHelpText>
                          </Stat>
                          <Stat size="sm">
                            <StatLabel>Data Completeness</StatLabel>
                            <StatNumber>
                              {analysis.valid_rows} / {analysis.total_rows}
                            </StatNumber>
                            <StatHelpText>
                              {analysis.empty_percentage > 0 && `${analysis.empty_percentage}% empty`}
                            </StatHelpText>
                          </Stat>
                        </SimpleGrid>
                      </Box>

                      {/* Sample Values */}
                      {analysis.sample_values.length > 0 && (
                        <Box>
                          <Text fontSize="sm" fontWeight="semibold" mb={2}>🔬 Sample Values:</Text>
                          <HStack wrap="wrap" spacing={2}>
                            {analysis.sample_values.slice(0, 5).map((value, index) => (
                              <Badge key={index} variant="outline" fontSize="xs">
                                {String(value).length > 20 ? `${String(value).substring(0, 20)}...` : String(value)}
                              </Badge>
                            ))}
                          </HStack>
                        </Box>
                      )}

                      {/* Recommendations */}
                      {analysis.recommendations.length > 0 && (
                        <Box>
                          <Text fontSize="sm" fontWeight="semibold" mb={2}>💡 Recommendations:</Text>
                          <List spacing={1}>
                            {analysis.recommendations.map((rec, index) => (
                              <ListItem key={index} fontSize="sm">
                                <ListIcon as={InfoIcon} color="blue.400" />
                                {rec}
                              </ListItem>
                            ))}
                          </List>
                        </Box>
                      )}
                    </VStack>
                  </AccordionPanel>
                </AccordionItem>
              );
            })}
          </Accordion>
        </CardBody>
      </Card>
    </VStack>
  );
}
